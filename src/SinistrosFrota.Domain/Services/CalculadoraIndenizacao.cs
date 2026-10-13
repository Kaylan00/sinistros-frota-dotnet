using SinistrosFrota.Domain.Exceptions;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Domain.Services;

public sealed record Indenizacao(decimal ValorBase, decimal Franquia, decimal ValorIndenizado)
{
    public bool TemIndenizacao => ValorIndenizado > 0;
}

/// <summary>
/// Quanto a seguradora paga:
/// base = menor entre o dano apurado e a cobertura;
/// franquia = maior entre (base × percentual) e a franquia mínima;
/// indenização = base − franquia (nunca negativa).
/// Roubo é perda total: paga a base sem franquia.
/// </summary>
public static class CalculadoraIndenizacao
{
    public static Indenizacao Calcular(Apolice apolice, TipoSinistro tipo, decimal valorApurado)
    {
        if (valorApurado < 0)
            throw new ValorInvalidoException("O valor apurado não pode ser negativo.");

        var valorBase = Math.Min(valorApurado, apolice.ValorCobertura);

        if (tipo == TipoSinistro.Roubo)
            return new Indenizacao(valorBase, 0m, Arredondar(valorBase));

        var franquia = Arredondar(Math.Max(valorBase * apolice.FranquiaPercentual / 100m, apolice.FranquiaMinima));
        var indenizado = Math.Max(0m, Arredondar(valorBase - franquia));

        return new Indenizacao(valorBase, franquia, indenizado);
    }

    private static decimal Arredondar(decimal valor) => Math.Round(valor, 2, MidpointRounding.AwayFromZero);
}
