using SinistrosFrota.Domain.Exceptions;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Tests;

public class SinistroTests
{
    [Fact]
    public void Abrir_com_apolice_vigente_cria_sinistro_aberto()
    {
        var s = Fabrica.SinistroAberto(valorEstimado: 1800m);

        Assert.Equal(StatusSinistro.Aberto, s.Status);
        Assert.Equal(1800m, s.ValorEstimado);
        Assert.Null(s.ValorIndenizado);
        Assert.Null(s.PagoEm);
    }

    [Fact]
    public void Abrir_com_apolice_vencida_falha()
    {
        var vencida = Fabrica.Apolice(inicio: new DateOnly(2025, 1, 1), fim: new DateOnly(2025, 12, 31));

        var ex = Assert.Throws<ApoliceForaDeVigenciaException>(() =>
            Sinistro.Abrir(vencida, 7, TipoSinistro.Roubo, new DateTime(2026, 2, 10, 22, 0, 0), "Moto levada na porta do cliente", 12000m, Fabrica.Agora));

        Assert.Equal("APL-2026-0001", ex.NumeroApolice);
    }

    [Fact]
    public void Abrir_com_apolice_que_ainda_nao_comecou_falha()
    {
        var futura = Fabrica.Apolice(inicio: new DateOnly(2026, 11, 1), fim: new DateOnly(2027, 10, 31));

        Assert.Throws<ApoliceForaDeVigenciaException>(() =>
            Sinistro.Abrir(futura, 7, TipoSinistro.Acidente, Fabrica.Agora.AddDays(-1), "Queda", 900m, Fabrica.Agora));
    }

    [Fact]
    public void Ocorrencia_no_ultimo_dia_da_vigencia_ainda_vale()
    {
        var apolice = Fabrica.Apolice(inicio: new DateOnly(2026, 1, 1), fim: new DateOnly(2026, 10, 12));

        var s = Sinistro.Abrir(apolice, 7, TipoSinistro.AvariaBau, new DateTime(2026, 10, 12, 23, 59, 0), "Baú trincado", 400m, Fabrica.Agora.AddDays(1));

        Assert.Equal(StatusSinistro.Aberto, s.Status);
    }

    [Fact]
    public void Ocorrencia_no_futuro_nao_pode_ser_registrada()
    {
        Assert.Throws<ValorInvalidoException>(() =>
            Sinistro.Abrir(Fabrica.Apolice(), 7, TipoSinistro.Acidente, Fabrica.Agora.AddHours(2), "x", 100m, Fabrica.Agora));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-50)]
    public void Valor_estimado_precisa_ser_positivo(decimal valor)
    {
        Assert.Throws<ValorInvalidoException>(() =>
            Sinistro.Abrir(Fabrica.Apolice(), 7, TipoSinistro.Acidente, Fabrica.Agora.AddHours(-1), "x", valor, Fabrica.Agora));
    }

    [Fact]
    public void Fluxo_completo_aberto_analise_aprovado_pago()
    {
        var s = Fabrica.SinistroAberto();
        var pagamento = Fabrica.Agora.AddDays(5);

        s.IniciarAnalise(Fabrica.Agora.AddHours(1));
        s.Aprovar(2700m, Fabrica.Agora.AddDays(2));
        s.Pagar(pagamento);

        Assert.Equal(StatusSinistro.Pago, s.Status);
        Assert.Equal(2700m, s.ValorIndenizado);
        Assert.Equal(pagamento, s.PagoEm);
        Assert.Equal(pagamento, s.AtualizadoEm);
    }

    [Fact]
    public void Negar_encerra_o_sinistro_sem_valor()
    {
        var s = Fabrica.SinistroEmAnalise();

        s.Negar(Fabrica.Agora);

        Assert.Equal(StatusSinistro.Negado, s.Status);
        Assert.Null(s.ValorIndenizado);
        Assert.Throws<TransicaoInvalidaException>(() => s.Pagar(Fabrica.Agora));
    }

    [Fact]
    public void Nao_aprova_sem_passar_pela_analise()
    {
        var s = Fabrica.SinistroAberto();

        var ex = Assert.Throws<TransicaoInvalidaException>(() => s.Aprovar(1000m, Fabrica.Agora));

        Assert.Equal(StatusSinistro.Aberto, ex.De);
        Assert.Equal(StatusSinistro.Aprovado, ex.Para);
        Assert.Equal(StatusSinistro.Aberto, s.Status); // nada mudou
    }

    [Fact]
    public void Aprovar_exige_valor_indenizado_positivo()
    {
        var s = Fabrica.SinistroEmAnalise();

        Assert.Throws<ValorInvalidoException>(() => s.Aprovar(0m, Fabrica.Agora));
        Assert.Equal(StatusSinistro.EmAnalise, s.Status);
    }

    [Fact]
    public void Nao_paga_sem_aprovar()
    {
        var s = Fabrica.SinistroEmAnalise();

        Assert.Throws<TransicaoInvalidaException>(() => s.Pagar(Fabrica.Agora));
    }

    [Fact]
    public void Pagamento_duplicado_e_bloqueado_com_erro_proprio()
    {
        var s = Fabrica.SinistroAprovado();
        var primeiroPagamento = Fabrica.Agora.AddDays(1);
        s.Pagar(primeiroPagamento);

        Assert.Throws<SinistroJaPagoException>(() => s.Pagar(Fabrica.Agora.AddDays(2)));
        Assert.Equal(primeiroPagamento, s.PagoEm); // a data do primeiro pagamento não é sobrescrita
    }
}
