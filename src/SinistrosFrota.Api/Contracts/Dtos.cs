using System.ComponentModel.DataAnnotations;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Contracts;

// ---------- Entrada ----------

public sealed record AbrirSinistroRequest
{
    [Range(1, int.MaxValue)]
    public int MotoristaId { get; init; }

    /// <summary>Opcional: sem ela, a API usa a apólice mais recente da moto do motorista.</summary>
    [Range(1, int.MaxValue)]
    public int? ApoliceId { get; init; }

    [Required]
    public TipoSinistro? Tipo { get; init; }

    [Required]
    public DateTimeOffset? DataOcorrencia { get; init; }

    [Required, StringLength(500, MinimumLength = 5)]
    public string Descricao { get; init; } = "";

    [Range(typeof(decimal), "0.01", "10000000")]
    public decimal ValorEstimado { get; init; }
}

public sealed record AlterarStatusSinistroRequest
{
    [Required]
    public StatusSinistro? NovoStatus { get; init; }

    [StringLength(300)]
    public string? Observacao { get; init; }

    /// <summary>Dano apurado na vistoria (só para aprovar). Sem ele, usa o valor estimado.</summary>
    [Range(typeof(decimal), "0.01", "10000000")]
    public decimal? ValorApurado { get; init; }
}

public sealed record PagarSinistroRequest
{
    [StringLength(300)]
    public string? Observacao { get; init; }
}

public sealed record NovoMotoristaRequest
{
    [Required, StringLength(120, MinimumLength = 3)]
    public string Nome { get; init; } = "";

    [Required, RegularExpression(@"^\d{11}$", ErrorMessage = "CPF com 11 dígitos, só números.")]
    public string Cpf { get; init; } = "";

    [StringLength(15)]
    public string? Telefone { get; init; }

    [Required, StringLength(80)]
    public string Restaurante { get; init; } = "";

    [Required, RegularExpression(@"^[A-Z]{3}\d[A-Z0-9]\d{2}$", ErrorMessage = "Placa no formato ABC1D23 ou ABC1234.")]
    public string Placa { get; init; } = "";

    [Required, StringLength(60)]
    public string Modelo { get; init; } = "";

    [Range(2000, 2100)]
    public short Ano { get; init; }
}

public sealed record AlterarStatusMotoristaRequest
{
    [Required]
    public StatusMotorista? Status { get; init; }

    [StringLength(200)]
    public string? Observacao { get; init; }
}

// ---------- Saída ----------

public sealed record SinistroItem(
    int Id,
    StatusSinistro Status,
    TipoSinistro Tipo,
    int MotoristaId,
    string Motorista,
    string Restaurante,
    string Placa,
    string NumeroApolice,
    decimal ValorEstimado,
    decimal? ValorIndenizado,
    DateTime DataOcorrencia,
    DateTime AbertoEm,
    DateTime AtualizadoEm,
    DateTime? PagoEm,
    IReadOnlyCollection<StatusSinistro> ProximosStatus);

public sealed record HistoricoItem(StatusSinistro? De, StatusSinistro Para, string? Observacao, string Usuario, DateTime AlteradoEm);

public sealed record SinistroDetalhe(SinistroItem Sinistro, string Descricao, string Seguradora, IReadOnlyList<HistoricoItem> Historico);

public sealed record ApoliceItem(int Id, string Numero, string Seguradora, string Placa, int MotoristaId,
    DateOnly InicioVigencia, DateOnly FimVigencia, decimal ValorCobertura, decimal FranquiaPercentual, decimal FranquiaMinima, bool VigenteHoje);

public sealed record MotoristaCriado(int Id, string Nome, string Placa);

/// <summary>Evento enviado pelo SignalR quando um sinistro muda.</summary>
public sealed record SinistroEvento(string Evento, SinistroItem Sinistro);
