namespace SinistrosFrota.Api.Services;

public sealed class RecursoNaoEncontradoException(string recurso, object id)
    : Exception($"{recurso} {id} não encontrado.");
