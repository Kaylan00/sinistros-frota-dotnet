using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Tests;

/// <summary>Monta objetos de teste com valores padrão, para cada teste mudar só o que importa.</summary>
internal static class Fabrica
{
    public static readonly DateTime Agora = new(2026, 10, 12, 14, 0, 0);

    public static Apolice Apolice(
        DateOnly? inicio = null,
        DateOnly? fim = null,
        decimal cobertura = 15000m,
        decimal franquiaPercentual = 10m,
        decimal franquiaMinima = 500m) =>
        new(
            id: 1,
            veiculoId: 1,
            numero: "APL-2026-0001",
            seguradora: "Seguradora Exemplo",
            inicioVigencia: inicio ?? new DateOnly(2026, 1, 1),
            fimVigencia: fim ?? new DateOnly(2026, 12, 31),
            valorCobertura: cobertura,
            franquiaPercentual: franquiaPercentual,
            franquiaMinima: franquiaMinima);

    public static Sinistro SinistroAberto(decimal valorEstimado = 3000m, TipoSinistro tipo = TipoSinistro.Acidente) =>
        Sinistro.Abrir(Apolice(), motoristaId: 7, tipo, Agora.AddHours(-3), "Batida leve no cruzamento", valorEstimado, Agora);

    public static Sinistro SinistroEmAnalise()
    {
        var s = SinistroAberto();
        s.IniciarAnalise(Agora);
        return s;
    }

    public static Sinistro SinistroAprovado(decimal valor = 2500m)
    {
        var s = SinistroEmAnalise();
        s.Aprovar(valor, Agora);
        return s;
    }
}
