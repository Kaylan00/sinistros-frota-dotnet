namespace SinistrosFrota.Domain.Models;

/// <summary>Ciclo de vida do sinistro. Os nomes batem com o CHECK da coluna Sinistros.Status.</summary>
public enum StatusSinistro
{
    Aberto,
    EmAnalise,
    Aprovado,
    Negado,
    Pago
}

public enum TipoSinistro
{
    Acidente,
    Roubo,
    AvariaMoto,
    AvariaBau
}

/// <summary>Situação do motoboy no quadro da frota.</summary>
public enum StatusMotorista
{
    Disponivel,
    EmEntrega,
    EmPausa,
    Ocorrencia
}
