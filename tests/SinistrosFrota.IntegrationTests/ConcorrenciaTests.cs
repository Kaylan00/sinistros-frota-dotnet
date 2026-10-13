using System.Net;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.IntegrationTests;

/// <summary>
/// O caso que justifica o UPDLOCK/HOLDLOCK da sp_PagarSinistro:
/// vários cliques ou integrações pagando o mesmo sinistro ao mesmo tempo.
/// </summary>
[Collection(ApiCollection.Nome)]
public class ConcorrenciaTests(ApiFixture api)
{
    [Fact]
    public async Task Dez_pagamentos_simultaneos_do_mesmo_sinistro_so_um_passa()
    {
        var s = await api.AprovadoAsync(motoristaId: 5, valor: 5000m);
        var id = s.Sinistro.Id;
        using var largada = new SemaphoreSlim(0);

        var tarefas = Enumerable.Range(0, 10).Select(async _ =>
        {
            await largada.WaitAsync();
            return await api.Client.PostAsync($"/api/sinistros/{id}/pagamento", null);
        }).ToList();
        largada.Release(10); // solta todas juntas

        var respostas = await Task.WhenAll(tarefas);

        Assert.Equal(1, respostas.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(9, respostas.Count(r => r.StatusCode == HttpStatusCode.Conflict));

        // no banco: exatamente uma linha de pagamento no histórico
        var pagamentos = await api.EscalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.SinistroHistorico WHERE SinistroId = @id AND StatusNovo = 'Pago'", ("@id", id));
        Assert.Equal(1, pagamentos);
    }

    [Fact]
    public async Task Aprovar_e_negar_ao_mesmo_tempo_so_uma_decisao_vale()
    {
        var s = await api.AbrirSinistroAsync(motoristaId: 6, valor: 2000m);
        var id = s.Sinistro.Id;
        (await api.TransicionarAsync(id, StatusSinistro.EmAnalise)).EnsureSuccessStatusCode();

        var decisoes = Enumerable.Range(0, 8)
            .Select(i => api.TransicionarAsync(id, i % 2 == 0 ? StatusSinistro.Aprovado : StatusSinistro.Negado));
        var respostas = await Task.WhenAll(decisoes);

        Assert.Equal(1, respostas.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.All(respostas.Where(r => r.StatusCode != HttpStatusCode.OK),
            r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));

        var decisoesGravadas = await api.EscalarAsync<int>(
            "SELECT COUNT(*) FROM dbo.SinistroHistorico WHERE SinistroId = @id AND StatusNovo IN ('Aprovado', 'Negado')", ("@id", id));
        Assert.Equal(1, decisoesGravadas);
    }
}
