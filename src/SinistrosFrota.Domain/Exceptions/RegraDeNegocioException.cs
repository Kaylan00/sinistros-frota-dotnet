using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Domain.Exceptions;

/// <summary>Base dos erros de regra. A API transforma cada uma em ProblemDetails com o status HTTP certo.</summary>
public abstract class RegraDeNegocioException(string mensagem) : Exception(mensagem);

/// <summary>Mudança de status fora do fluxo Aberto → EmAnalise → Aprovado|Negado, Aprovado → Pago.</summary>
public sealed class TransicaoInvalidaException(StatusSinistro de, StatusSinistro para)
    : RegraDeNegocioException($"Transição de {de} para {para} não é permitida.")
{
    public StatusSinistro De { get; } = de;
    public StatusSinistro Para { get; } = para;
}

public sealed class SinistroJaPagoException(int sinistroId)
    : RegraDeNegocioException($"O sinistro {sinistroId} já foi pago.")
{
    public int SinistroId { get; } = sinistroId;
}

public sealed class ApoliceForaDeVigenciaException(string numeroApolice, DateTime dataOcorrencia)
    : RegraDeNegocioException($"A apólice {numeroApolice} não estava vigente em {dataOcorrencia:dd/MM/yyyy}.")
{
    public string NumeroApolice { get; } = numeroApolice;
}

public sealed class ValorInvalidoException(string mensagem) : RegraDeNegocioException(mensagem);
