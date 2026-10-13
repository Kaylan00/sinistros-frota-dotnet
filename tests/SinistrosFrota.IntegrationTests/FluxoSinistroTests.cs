using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using SinistrosFrota.Api.Contracts;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.IntegrationTests;

[Collection(ApiCollection.Nome)]
public class FluxoSinistroTests(ApiFixture api)
{
    [Fact]
    public async Task Fluxo_completo_grava_historico_e_calcula_indenizacao()
    {
        var aberto = await api.AbrirSinistroAsync(motoristaId: 1, valor: 3000m);
        var id = aberto.Sinistro.Id;
        Assert.Equal(StatusSinistro.Aberto, aberto.Sinistro.Status);

        // a procedure de abertura também coloca o motoboy em ocorrência
        var motorista = await api.Client.GetFromJsonAsync<MotoristaStatusAtual>("/api/motoristas/1", ApiFixture.Json);
        Assert.Equal(StatusMotorista.Ocorrencia, motorista!.Status);

        (await api.TransicionarAsync(id, StatusSinistro.EmAnalise)).EnsureSuccessStatusCode();
        var aprovado = await (await api.TransicionarAsync(id, StatusSinistro.Aprovado, valorApurado: 2800m))
            .Content.ReadFromJsonAsync<SinistroDetalhe>(ApiFixture.Json);
        Assert.Equal(2400m, aprovado!.Sinistro.ValorIndenizado); // 2.800 - franquia mínima 400

        var pagamento = await api.Client.PostAsJsonAsync($"/api/sinistros/{id}/pagamento", new { observacao = "PIX" });
        Assert.Equal(HttpStatusCode.OK, pagamento.StatusCode);

        var detalhe = await api.Client.GetFromJsonAsync<SinistroDetalhe>($"/api/sinistros/{id}", ApiFixture.Json);
        Assert.Equal(StatusSinistro.Pago, detalhe!.Sinistro.Status);
        Assert.NotNull(detalhe.Sinistro.PagoEm);
        Assert.Empty(detalhe.Sinistro.ProximosStatus);
        Assert.Equal(
            new StatusSinistro[] { StatusSinistro.Aberto, StatusSinistro.EmAnalise, StatusSinistro.Aprovado, StatusSinistro.Pago },
            detalhe.Historico.Select(h => h.Para));
    }

    [Fact]
    public async Task Transicao_fora_do_fluxo_retorna_409_em_problem_details()
    {
        var s = await api.AbrirSinistroAsync(motoristaId: 2);

        var resp = await api.TransicionarAsync(s.Sinistro.Id, StatusSinistro.Aprovado);

        Assert.Equal(HttpStatusCode.Conflict, resp.StatusCode);
        Assert.Equal("application/problem+json", resp.Content.Headers.ContentType?.MediaType);
        var problema = await resp.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.Equal("transicao_invalida", problema!.Extensions["codigo"]?.ToString());
        Assert.Contains("Aberto para Aprovado", problema.Detail);
    }

    [Fact]
    public async Task Apolice_vencida_retorna_422()
    {
        // no seed, a apólice da motorista 8 venceu há 20 dias
        var resp = await api.Client.PostAsJsonAsync("/api/sinistros", new
        {
            motoristaId = 8,
            tipo = "Acidente",
            dataOcorrencia = DateTimeOffset.UtcNow.AddHours(-1),
            descricao = "Queda na rotatória",
            valorEstimado = 1200
        });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        var problema = await resp.Content.ReadFromJsonAsync<ProblemDetails>();
        Assert.Equal("apolice_fora_de_vigencia", problema!.Extensions["codigo"]?.ToString());
    }

    [Fact]
    public async Task Dano_abaixo_da_franquia_nao_pode_ser_aprovado()
    {
        var s = await api.AbrirSinistroAsync(motoristaId: 3, valor: 350m, tipo: TipoSinistro.AvariaBau);
        (await api.TransicionarAsync(s.Sinistro.Id, StatusSinistro.EmAnalise)).EnsureSuccessStatusCode();

        var resp = await api.TransicionarAsync(s.Sinistro.Id, StatusSinistro.Aprovado);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, resp.StatusCode);
        var negado = await api.TransicionarAsync(s.Sinistro.Id, StatusSinistro.Negado);
        Assert.Equal(HttpStatusCode.OK, negado.StatusCode);
    }

    [Fact]
    public async Task Dados_invalidos_retornam_400_e_sinistro_inexistente_404()
    {
        var invalido = await api.Client.PostAsJsonAsync("/api/sinistros", new { motoristaId = 1, valorEstimado = 0, descricao = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, invalido.StatusCode);

        var inexistente = await api.Client.GetAsync("/api/sinistros/999999");
        Assert.Equal(HttpStatusCode.NotFound, inexistente.StatusCode);

        var transicao = await api.TransicionarAsync(999999, StatusSinistro.EmAnalise);
        Assert.Equal(HttpStatusCode.NotFound, transicao.StatusCode);
    }

    [Fact]
    public async Task Procedure_bloqueia_mesmo_quem_escreve_direto_no_banco()
    {
        // Simula outro sistema (ou um script) chamando a procedure sem passar pela API/C#
        var s = await api.AbrirSinistroAsync(motoristaId: 4);
        await using var conexao = await api.AbrirConexaoAsync();

        var pularAnalise = new SqlCommand("EXEC dbo.sp_AlterarStatusSinistro @SinistroId = @id, @NovoStatus = 'Aprovado', @Usuario = N'script', @ValorIndenizado = 100", conexao);
        pularAnalise.Parameters.AddWithValue("@id", s.Sinistro.Id);
        var erro = await Assert.ThrowsAsync<SqlException>(() => pularAnalise.ExecuteNonQueryAsync());
        Assert.Equal(50003, erro.Number);

        var pagarAberto = new SqlCommand("EXEC dbo.sp_PagarSinistro @SinistroId = @id, @Usuario = N'script'", conexao);
        pagarAberto.Parameters.AddWithValue("@id", s.Sinistro.Id);
        erro = await Assert.ThrowsAsync<SqlException>(() => pagarAberto.ExecuteNonQueryAsync());
        Assert.Equal(50003, erro.Number);

        // o ROLLBACK do CATCH não deixou nada pela metade
        var status = await api.EscalarAsync<string>("SELECT Status FROM dbo.Sinistros WHERE Id = @id", ("@id", s.Sinistro.Id));
        Assert.Equal("Aberto", status);
    }

    [Fact]
    public async Task Cadastro_de_motorista_e_cpf_duplicado()
    {
        var novo = new
        {
            nome = "Luana Prates",
            cpf = "20000000001",
            restaurante = "Sabor de Casa - Centro",
            placa = "RQK1L23",
            modelo = "Honda CG 160 Cargo",
            ano = 2025
        };

        var criado = await api.Client.PostAsJsonAsync("/api/motoristas", novo);
        Assert.Equal(HttpStatusCode.Created, criado.StatusCode);

        var duplicado = await api.Client.PostAsJsonAsync("/api/motoristas", novo with { });
        Assert.Equal(HttpStatusCode.Conflict, duplicado.StatusCode);
    }
}
