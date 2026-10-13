using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using SinistrosFrota.Api.Services;
using SinistrosFrota.Domain.Exceptions;

namespace SinistrosFrota.Api.Erros;

/// <summary>
/// Converte exceções em ProblemDetails (RFC 7807), o formato padrão de erro do ASP.NET Core.
/// Vale tanto para a regra do domínio (C#) quanto para os THROW 50xxx das procedures.
/// </summary>
public class TratadorDeErros(IProblemDetailsService problemDetails, ILogger<TratadorDeErros> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken ct)
    {
        var (status, codigo, titulo) = Classificar(exception);
        if (status == StatusCodes.Status500InternalServerError)
            logger.LogError(exception, "Erro não tratado");

        http.Response.StatusCode = status;
        var problema = new ProblemDetails
        {
            Status = status,
            Title = titulo,
            Detail = status == 500 ? "Erro inesperado. Tente de novo em instantes." : MensagemDe(exception),
            Type = $"https://httpstatuses.io/{status}"
        };
        problema.Extensions["codigo"] = codigo;

        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = http,
            ProblemDetails = problema,
            Exception = exception
        });
    }

    internal static (int Status, string Codigo, string Titulo) Classificar(Exception ex) => ex switch
    {
        RecursoNaoEncontradoException => (404, "nao_encontrado", "Não encontrado"),
        TransicaoInvalidaException => (409, "transicao_invalida", "Transição de status inválida"),
        SinistroJaPagoException => (409, "ja_pago", "Sinistro já pago"),
        ApoliceForaDeVigenciaException => (422, "apolice_fora_de_vigencia", "Apólice fora de vigência"),
        ValorInvalidoException => (422, "valor_invalido", "Dados inválidos"),
        SqlException sql when sql.Number is >= 50001 and <= 50099 => ErroDeProcedure(sql.Number),
        DbUpdateException { InnerException: SqlException { Number: 2627 or 2601 } } => (409, "duplicado", "Registro duplicado"),
        DbUpdateException { InnerException: SqlException { Number: 547 } } => (422, "restricao", "Violação de regra do banco"),
        _ => (500, "erro_interno", "Erro interno")
    };

    private static (int, string, string) ErroDeProcedure(int numero) => numero switch
    {
        50001 or 50005 or 50007 => (404, "nao_encontrado", "Não encontrado"),
        50002 => (422, "apolice_fora_de_vigencia", "Apólice fora de vigência"),
        50003 => (409, "transicao_invalida", "Transição de status inválida"),
        50004 => (409, "ja_pago", "Sinistro já pago"),
        _ => (422, "valor_invalido", "Dados inválidos")
    };

    private static string MensagemDe(Exception ex) => ex switch
    {
        DbUpdateException { InnerException: SqlException { Number: 2627 or 2601 } } => "Já existe um cadastro com esse CPF ou placa.",
        DbUpdateException { InnerException: SqlException sql } => sql.Message,
        _ => ex.Message
    };
}
