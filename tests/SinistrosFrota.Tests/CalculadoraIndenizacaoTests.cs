using SinistrosFrota.Domain.Exceptions;
using SinistrosFrota.Domain.Models;
using SinistrosFrota.Domain.Services;

namespace SinistrosFrota.Tests;

public class CalculadoraIndenizacaoTests
{
    [Fact]
    public void Franquia_percentual_quando_maior_que_a_minima()
    {
        // 10% de 8.000 = 800, maior que a mínima de 500
        var apolice = Fabrica.Apolice(cobertura: 15000m, franquiaPercentual: 10m, franquiaMinima: 500m);

        var r = CalculadoraIndenizacao.Calcular(apolice, TipoSinistro.Acidente, valorApurado: 8000m);

        Assert.Equal(8000m, r.ValorBase);
        Assert.Equal(800m, r.Franquia);
        Assert.Equal(7200m, r.ValorIndenizado);
    }

    [Fact]
    public void Franquia_minima_quando_o_percentual_da_menos()
    {
        // 10% de 2.000 = 200, menor que a mínima de 500
        var apolice = Fabrica.Apolice(franquiaPercentual: 10m, franquiaMinima: 500m);

        var r = CalculadoraIndenizacao.Calcular(apolice, TipoSinistro.AvariaMoto, 2000m);

        Assert.Equal(500m, r.Franquia);
        Assert.Equal(1500m, r.ValorIndenizado);
    }

    [Fact]
    public void Valor_acima_da_cobertura_fica_limitado_ao_teto()
    {
        var apolice = Fabrica.Apolice(cobertura: 10000m, franquiaPercentual: 10m, franquiaMinima: 500m);

        var r = CalculadoraIndenizacao.Calcular(apolice, TipoSinistro.Acidente, 14000m);

        Assert.Equal(10000m, r.ValorBase);
        Assert.Equal(1000m, r.Franquia);
        Assert.Equal(9000m, r.ValorIndenizado);
    }

    [Fact]
    public void Dano_menor_que_a_franquia_nao_gera_indenizacao()
    {
        var apolice = Fabrica.Apolice(franquiaMinima: 500m);

        var r = CalculadoraIndenizacao.Calcular(apolice, TipoSinistro.AvariaBau, 350m);

        Assert.Equal(0m, r.ValorIndenizado);
        Assert.False(r.TemIndenizacao);
    }

    [Fact]
    public void Roubo_e_perda_total_sem_franquia()
    {
        var apolice = Fabrica.Apolice(cobertura: 15000m, franquiaPercentual: 10m, franquiaMinima: 500m);

        var r = CalculadoraIndenizacao.Calcular(apolice, TipoSinistro.Roubo, 16000m);

        Assert.Equal(0m, r.Franquia);
        Assert.Equal(15000m, r.ValorIndenizado);
    }

    [Fact]
    public void Arredonda_centavos_para_duas_casas()
    {
        // 7,5% de 1.234,57 = 92,592... -> mínima 50 não se aplica -> franquia 92,59
        var apolice = Fabrica.Apolice(franquiaPercentual: 7.5m, franquiaMinima: 50m);

        var r = CalculadoraIndenizacao.Calcular(apolice, TipoSinistro.Acidente, 1234.57m);

        Assert.Equal(92.59m, r.Franquia);
        Assert.Equal(1141.98m, r.ValorIndenizado);
    }

    [Fact]
    public void Valor_apurado_negativo_e_rejeitado()
    {
        Assert.Throws<ValorInvalidoException>(() =>
            CalculadoraIndenizacao.Calcular(Fabrica.Apolice(), TipoSinistro.Acidente, -1m));
    }
}
