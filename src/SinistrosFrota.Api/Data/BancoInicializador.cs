using Microsoft.Data.SqlClient;

namespace SinistrosFrota.Api.Data;

/// <summary>
/// Na subida da API: cria a base se não existir e aplica os scripts numerados
/// (01_schema, 02_views, 03_procedures e, se ligado, 04_seed). Todos são idempotentes.
/// Os scripts de ajustes/ nunca rodam sozinhos: são executados por uma pessoa, com conferência.
/// </summary>
public static class BancoInicializador
{
    public static async Task ExecutarAsync(string connectionString, bool aplicarSeed, ILogger logger, CancellationToken ct = default)
    {
        var builder = new SqlConnectionStringBuilder(connectionString);
        var nomeBanco = builder.InitialCatalog;
        if (string.IsNullOrWhiteSpace(nomeBanco))
            throw new InvalidOperationException("A connection string precisa informar o Database.");

        var master = new SqlConnectionStringBuilder(connectionString) { InitialCatalog = "master" }.ConnectionString;

        await using (var conexao = await AbrirComRetentativaAsync(master, logger, ct))
        {
            await using var cmd = new SqlCommand(
                "IF DB_ID(@nome) IS NULL BEGIN DECLARE @sql NVARCHAR(300) = N'CREATE DATABASE ' + QUOTENAME(@nome); EXEC (@sql); END",
                conexao);
            cmd.Parameters.AddWithValue("@nome", nomeBanco);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        var arquivos = Directory.GetFiles(ScriptsSql.PastaPadrao, "0*.sql")
            .Order(StringComparer.Ordinal)
            .Where(a => aplicarSeed || !Path.GetFileName(a).Contains("seed", StringComparison.OrdinalIgnoreCase))
            .ToList();

        await using var conexaoBanco = new SqlConnection(connectionString);
        await conexaoBanco.OpenAsync(ct);
        foreach (var arquivo in arquivos)
        {
            logger.LogInformation("Aplicando {Script}", Path.GetFileName(arquivo));
            await ScriptsSql.ExecutarArquivoAsync(conexaoBanco, arquivo, ct);
        }
    }

    private static async Task<SqlConnection> AbrirComRetentativaAsync(string connectionString, ILogger logger, CancellationToken ct)
    {
        for (var tentativa = 1; ; tentativa++)
        {
            var conexao = new SqlConnection(connectionString);
            try
            {
                await conexao.OpenAsync(ct);
                return conexao;
            }
            catch (SqlException ex) when (tentativa < 15)
            {
                await conexao.DisposeAsync();
                logger.LogWarning("SQL Server ainda não respondeu (tentativa {Tentativa}): {Erro}", tentativa, ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(2), ct);
            }
        }
    }
}
