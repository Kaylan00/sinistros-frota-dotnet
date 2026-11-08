using System.Net;
using System.Net.Http.Json;
using Microsoft.Data.SqlClient;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Api.Pages.Relatorios;
using SinistrosFrota.Api.Relatorios;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.IntegrationTests;

/// <summary>Tela de relatórios (Razor Pages) e as consultas Dapper por trás dela.</summary>
[Collection(ApiCollection.Nome)]
public class RelatoriosTests(ApiFixture api)
{
    private RelatoriosRepository Repositorio() => new(new ConexaoSql(api.ConnectionString), TimeProvider.System);

    [Fact]
    public async Task Pagina_abre_com_resumo_fila_e_filtros()
    {
        var resp = await api.Client.GetAsync("/relatorios");
        var html = await resp.Content.ReadAsStringAsync();

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Contains("Sinistros por mês", html);
        Assert.Contains("id=\"resumo\"", html);      // a seed tem sinistros nos últimos meses
        Assert.Contains("id=\"fila\"", html);
        Assert.Contains("Seguradora Exemplo", html); // opção do filtro veio do banco
    }

    [Fact]
    public async Task Resumo_do_Dapper_bate_com_a_API_feita_em_EF_Core()
    {
        var dapper = await Repositorio().ResumoPorMesAsync(new FiltroRelatorio(Meses: 6));
        var ef = await api.Client.GetFromJsonAsync<List<ResumoSinistrosMes>>(
            "/api/relatorios/sinistros-por-mes?meses=6", ApiFixture.Json);

        Assert.NotEmpty(dapper);
        Assert.Equal(ef!.Sum(r => r.Quantidade), dapper.Sum(r => r.Quantidade));
        Assert.Equal(ef.Sum(r => r.ValorEstimadoTotal), dapper.Sum(r => r.ValorEstimadoTotal));
        Assert.Equal(ef.Sum(r => r.ValorPago), dapper.Sum(r => r.ValorPago));
    }

    [Fact]
    public async Task Filtros_de_tipo_seguradora_e_horas_restringem_a_fila()
    {
        var roubo = await api.AbrirSinistroAsync(motoristaId: 5, valor: 4200m, tipo: TipoSinistro.Roubo);
        var repo = Repositorio();

        var soRoubo = await repo.EmAbertoAsync(new FiltroRelatorio(Tipo: "Roubo"));
        Assert.Contains(soRoubo, l => l.SinistroId == roubo.Sinistro.Id);
        Assert.All(soRoubo, l => Assert.Equal("Roubo", l.Tipo));

        var outraSeguradora = await repo.EmAbertoAsync(new FiltroRelatorio(Seguradora: "Seguradora Que Nao Existe"));
        Assert.Empty(outraSeguradora);

        // aberto agora: não pode aparecer quando o filtro pede 1 ano em aberto
        var antigos = await repo.EmAbertoAsync(new FiltroRelatorio(HorasMinimas: 8760));
        Assert.DoesNotContain(antigos, l => l.SinistroId == roubo.Sinistro.Id);
    }

    [Fact]
    public async Task Csv_da_fila_respeita_o_filtro()
    {
        var avaria = await api.AbrirSinistroAsync(motoristaId: 7, valor: 640m, tipo: TipoSinistro.AvariaBau);

        var resp = await api.Client.GetAsync("/relatorios?handler=Csv&tipo=AvariaBau");
        var csv = await resp.Content.ReadAsStringAsync();
        var linhas = csv.TrimStart('﻿').Split('\n', StringSplitOptions.RemoveEmptyEntries);

        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        Assert.Equal("text/csv", resp.Content.Headers.ContentType!.MediaType);
        Assert.StartsWith("Sinistro;Status;Tipo;", linhas[0]);
        Assert.Contains(linhas, l => l.StartsWith($"{avaria.Sinistro.Id};Aberto;AvariaBau;"));
        Assert.All(linhas.Skip(1), l => Assert.Equal("AvariaBau", l.Split(';')[2]));
    }

    [Fact]
    public async Task Filtro_invalido_mostra_erro_na_tela_e_400_no_csv()
    {
        var pagina = await api.Client.GetStringAsync("/relatorios?meses=99");
        Assert.Contains("O período vai de 1 a 24 meses.", pagina);
        Assert.DoesNotContain("id=\"resumo\"", pagina);

        var csv = await api.Client.GetAsync("/relatorios?handler=Csv&tipo=Terremoto");
        Assert.Equal(HttpStatusCode.BadRequest, csv.StatusCode);
    }

    [Fact]
    public async Task Relatorio_nao_espera_lock_de_escrita_em_andamento()
    {
        // Regressão do deadlock achado no teste de carga: com READ_COMMITTED_SNAPSHOT a leitura
        // não fica presa atrás de uma transação de escrita aberta na mesma linha.
        var s = await api.AbrirSinistroAsync(motoristaId: 6, valor: 1500m, tipo: TipoSinistro.AvariaMoto);

        await using var escrita = await api.AbrirConexaoAsync();
        await using var tx = escrita.BeginTransaction();
        await using (var cmd = new SqlCommand(
            "UPDATE dbo.Sinistros SET ValorEstimado = ValorEstimado + 1 WHERE Id = @id", escrita, tx))
        {
            cmd.Parameters.AddWithValue("@id", s.Sinistro.Id);
            await cmd.ExecuteNonQueryAsync();
        }

        using var limite = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var fila = await Repositorio().EmAbertoAsync(new FiltroRelatorio(), limite.Token);

        // leu a versão confirmada (sem o +1 que ainda não foi commitado)
        Assert.Equal(1500m, fila.Single(l => l.SinistroId == s.Sinistro.Id).ValorEstimado);
        await tx.RollbackAsync();
    }

    [Theory]
    [InlineData("Rafael Monteiro", "Rafael Monteiro")]
    [InlineData("Sabor; Centro", "\"Sabor; Centro\"")]
    [InlineData("=HYPERLINK(\"x\")", "\"'=HYPERLINK(\"\"x\"\")\"")]
    public void Campo_do_csv_escapa_separador_e_formula(string entrada, string esperado) =>
        Assert.Equal(esperado, IndexModel.Campo(entrada));
}
