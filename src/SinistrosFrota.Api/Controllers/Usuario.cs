namespace SinistrosFrota.Api.Controllers;

/// <summary>
/// Quem fez a ação, para o histórico. Sem autenticação neste projeto de estudo:
/// vem do cabeçalho X-Usuario (num sistema real viria do token de login).
/// </summary>
internal static class Usuario
{
    public static string De(HttpRequest request)
    {
        var valor = request.Headers["X-Usuario"].ToString().Trim();
        return valor.Length is > 0 and <= 60 ? valor : "central";
    }
}
