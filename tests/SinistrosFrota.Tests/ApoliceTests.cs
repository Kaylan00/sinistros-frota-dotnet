using SinistrosFrota.Domain.Exceptions;

namespace SinistrosFrota.Tests;

public class ApoliceTests
{
    [Fact]
    public void Vigencia_inclui_o_primeiro_e_o_ultimo_dia()
    {
        var a = Fabrica.Apolice(inicio: new DateOnly(2026, 3, 1), fim: new DateOnly(2026, 3, 31));

        Assert.True(a.EstaVigenteEm(new DateTime(2026, 3, 1, 0, 0, 0)));
        Assert.True(a.EstaVigenteEm(new DateTime(2026, 3, 31, 23, 59, 59)));
        Assert.False(a.EstaVigenteEm(new DateTime(2026, 2, 28, 23, 59, 59)));
        Assert.False(a.EstaVigenteEm(new DateTime(2026, 4, 1, 0, 0, 0)));
    }

    [Fact]
    public void Fim_antes_do_inicio_e_invalido()
    {
        Assert.Throws<ValorInvalidoException>(() =>
            Fabrica.Apolice(inicio: new DateOnly(2026, 5, 1), fim: new DateOnly(2026, 4, 30)));
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(101)]
    public void Percentual_de_franquia_fora_de_0_a_100_e_invalido(decimal pct)
    {
        Assert.Throws<ValorInvalidoException>(() => Fabrica.Apolice(franquiaPercentual: pct));
    }
}
