using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Models;

/// <summary>Linha da view vw_MotoristasStatusAtual.</summary>
public class MotoristaStatusAtual
{
    public int MotoristaId { get; set; }
    public string Nome { get; set; } = "";
    public string Restaurante { get; set; } = "";
    public string? Placa { get; set; }
    public string? Modelo { get; set; }
    public StatusMotorista Status { get; set; }
    public string? Observacao { get; set; }
    public DateTime? StatusDesde { get; set; }
    public int SinistrosAtivos { get; set; }
}

/// <summary>Linha da view vw_SinistrosEmAberto.</summary>
public class SinistroEmAberto
{
    public int SinistroId { get; set; }
    public StatusSinistro Status { get; set; }
    public TipoSinistro Tipo { get; set; }
    public DateTime DataOcorrencia { get; set; }
    public DateTime AbertoEm { get; set; }
    public DateTime AtualizadoEm { get; set; }
    public decimal ValorEstimado { get; set; }
    public decimal? ValorIndenizado { get; set; }
    public int MotoristaId { get; set; }
    public string Motorista { get; set; } = "";
    public string Restaurante { get; set; } = "";
    public string Placa { get; set; } = "";
    public string NumeroApolice { get; set; } = "";
    public string Seguradora { get; set; } = "";
    public int HorasEmAberto { get; set; }
}

/// <summary>Linha da view vw_ResumoSinistrosPorMes.</summary>
public class ResumoSinistrosMes
{
    public DateOnly Mes { get; set; }
    public TipoSinistro Tipo { get; set; }
    public int Quantidade { get; set; }
    public int EmAndamento { get; set; }
    public int Aprovados { get; set; }
    public int Negados { get; set; }
    public decimal ValorEstimadoTotal { get; set; }
    public decimal ValorIndenizadoTotal { get; set; }
    public decimal ValorPago { get; set; }
}
