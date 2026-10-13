using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.SqlClient;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Data;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.IntegrationTests;

/// <summary>
/// Sobe a API inteira em memória (WebApplicationFactory) contra um SQL Server de verdade.
/// A base de teste é apagada no começo; a própria API recria tudo com os scripts
/// de database/ (schema, views, procedures e seed), igual acontece em produção.
///
/// Banco: variável SINISTROS_TEST_CONNECTION ou, se não houver, o sqlserver-test do
/// docker compose (porta SQL_TEST_PORT do .env, padrão 14331).
/// </summary>
public sealed class ApiFixture : IAsyncLifetime
{
    public WebApplicationFactory<Program> Factory { get; }
    public HttpClient Client { get; private set; } = null!;
    public string ConnectionString { get; }

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() }
    };

    public ApiFixture()
    {
        ConnectionString = Environment.GetEnvironmentVariable("SINISTROS_TEST_CONNECTION")
            ?? ArquivoEnv.ConnectionStringLocal("SinistrosFrotaTestes", "SQL_TEST_PORT", "14331")
            ?? throw new InvalidOperationException(
                "Sem banco para os testes de integração. Rode 'docker compose --profile test up -d sqlserver-test' " +
                "com o .env criado, ou defina SINISTROS_TEST_CONNECTION.");

        // Variáveis de ambiente entram na configuração da API antes do Program.cs ler a connection string
        Environment.SetEnvironmentVariable("ConnectionStrings__SinistrosDb", ConnectionString);
        Environment.SetEnvironmentVariable("Simulador__Ativo", "false");

        Factory = new WebApplicationFactory<Program>();
    }

    public async Task InitializeAsync()
    {
        await ApagarBancoAsync();
        Client = Factory.CreateClient(); // aqui a API sobe e aplica os scripts
    }

    public async Task DisposeAsync()
    {
        Client.Dispose();
        await Factory.DisposeAsync();
    }

    private async Task ApagarBancoAsync()
    {
        var nome = new SqlConnectionStringBuilder(ConnectionString).InitialCatalog;
        var master = new SqlConnectionStringBuilder(ConnectionString) { InitialCatalog = "master" }.ConnectionString;
        await using var conexao = new SqlConnection(master);
        await conexao.OpenAsync();
        await using var cmd = new SqlCommand(
            """
            IF DB_ID(@nome) IS NOT NULL
            BEGIN
                DECLARE @sql NVARCHAR(400) = N'ALTER DATABASE ' + QUOTENAME(@nome) + N' SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ' + QUOTENAME(@nome);
                EXEC (@sql);
            END
            """, conexao);
        cmd.Parameters.AddWithValue("@nome", nome);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task<SqlConnection> AbrirConexaoAsync()
    {
        var conexao = new SqlConnection(ConnectionString);
        await conexao.OpenAsync();
        return conexao;
    }

    public async Task<T> EscalarAsync<T>(string sql, params (string Nome, object Valor)[] parametros)
    {
        await using var conexao = await AbrirConexaoAsync();
        await using var cmd = new SqlCommand(sql, conexao);
        foreach (var (n, v) in parametros) cmd.Parameters.AddWithValue(n, v);
        return (T)(await cmd.ExecuteScalarAsync())!;
    }

    // ---------- atalhos de API ----------

    public async Task<SinistroDetalhe> AbrirSinistroAsync(int motoristaId, decimal valor = 3000m, TipoSinistro tipo = TipoSinistro.Acidente)
    {
        var resp = await Client.PostAsJsonAsync("/api/sinistros", new
        {
            motoristaId,
            tipo,
            dataOcorrencia = DateTimeOffset.UtcNow.AddHours(-2),
            descricao = "Queda em pista molhada (teste)",
            valorEstimado = valor
        }, Json);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<SinistroDetalhe>(Json))!;
    }

    public Task<HttpResponseMessage> TransicionarAsync(int id, StatusSinistro novo, decimal? valorApurado = null) =>
        Client.PostAsJsonAsync($"/api/sinistros/{id}/transicoes", new { novoStatus = novo, valorApurado }, Json);

    public async Task<SinistroDetalhe> AprovadoAsync(int motoristaId, decimal valor = 3000m)
    {
        var s = await AbrirSinistroAsync(motoristaId, valor);
        (await TransicionarAsync(s.Sinistro.Id, StatusSinistro.EmAnalise)).EnsureSuccessStatusCode();
        var resp = await TransicionarAsync(s.Sinistro.Id, StatusSinistro.Aprovado);
        resp.EnsureSuccessStatusCode();
        return (await resp.Content.ReadFromJsonAsync<SinistroDetalhe>(Json))!;
    }
}

[CollectionDefinition(Nome)]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>
{
    public const string Nome = "API com SQL Server";
}
