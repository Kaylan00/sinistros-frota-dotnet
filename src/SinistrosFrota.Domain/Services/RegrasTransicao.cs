using SinistrosFrota.Domain.Exceptions;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Domain.Services;

/// <summary>
/// Tabela de transições do sinistro. É a mesma regra que a procedure
/// sp_AlterarStatusSinistro confere no banco (defesa em duas camadas).
/// </summary>
public static class RegrasTransicao
{
    private static readonly Dictionary<StatusSinistro, StatusSinistro[]> Permitidas = new()
    {
        [StatusSinistro.Aberto] = [StatusSinistro.EmAnalise],
        [StatusSinistro.EmAnalise] = [StatusSinistro.Aprovado, StatusSinistro.Negado],
        [StatusSinistro.Aprovado] = [StatusSinistro.Pago],
        [StatusSinistro.Negado] = [],
        [StatusSinistro.Pago] = []
    };

    public static bool PodeIr(StatusSinistro de, StatusSinistro para) =>
        Permitidas.TryGetValue(de, out var destinos) && destinos.Contains(para);

    public static IReadOnlyCollection<StatusSinistro> Proximos(StatusSinistro de) =>
        Permitidas.TryGetValue(de, out var destinos) ? destinos : [];

    public static void Validar(StatusSinistro de, StatusSinistro para)
    {
        if (!PodeIr(de, para))
            throw new TransicaoInvalidaException(de, para);
    }
}
