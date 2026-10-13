using SinistrosFrota.Domain.Exceptions;
using SinistrosFrota.Domain.Models;
using SinistrosFrota.Domain.Services;

namespace SinistrosFrota.Tests;

public class RegrasTransicaoTests
{
    [Theory]
    [InlineData(StatusSinistro.Aberto, StatusSinistro.EmAnalise)]
    [InlineData(StatusSinistro.EmAnalise, StatusSinistro.Aprovado)]
    [InlineData(StatusSinistro.EmAnalise, StatusSinistro.Negado)]
    [InlineData(StatusSinistro.Aprovado, StatusSinistro.Pago)]
    public void Transicoes_do_fluxo_sao_permitidas(StatusSinistro de, StatusSinistro para)
    {
        Assert.True(RegrasTransicao.PodeIr(de, para));
    }

    [Theory]
    [InlineData(StatusSinistro.Aberto, StatusSinistro.Aprovado)]   // pular a análise
    [InlineData(StatusSinistro.Aberto, StatusSinistro.Pago)]
    [InlineData(StatusSinistro.EmAnalise, StatusSinistro.Pago)]    // pagar sem aprovar
    [InlineData(StatusSinistro.Aprovado, StatusSinistro.Negado)]
    [InlineData(StatusSinistro.Negado, StatusSinistro.Aprovado)]   // negado é final
    [InlineData(StatusSinistro.Negado, StatusSinistro.Pago)]
    [InlineData(StatusSinistro.Pago, StatusSinistro.Aberto)]       // pago é final
    [InlineData(StatusSinistro.EmAnalise, StatusSinistro.Aberto)]  // não volta
    [InlineData(StatusSinistro.Aberto, StatusSinistro.Aberto)]     // nem fica no mesmo
    public void Transicoes_fora_do_fluxo_sao_bloqueadas(StatusSinistro de, StatusSinistro para)
    {
        Assert.False(RegrasTransicao.PodeIr(de, para));
        Assert.Throws<TransicaoInvalidaException>(() => RegrasTransicao.Validar(de, para));
    }

    [Fact]
    public void Status_finais_nao_tem_proximo_passo()
    {
        Assert.Empty(RegrasTransicao.Proximos(StatusSinistro.Negado));
        Assert.Empty(RegrasTransicao.Proximos(StatusSinistro.Pago));
    }

    [Fact]
    public void Em_analise_pode_ir_para_aprovado_ou_negado()
    {
        Assert.Equal(
            new[] { StatusSinistro.Aprovado, StatusSinistro.Negado },
            RegrasTransicao.Proximos(StatusSinistro.EmAnalise).OrderBy(s => s));
    }
}
