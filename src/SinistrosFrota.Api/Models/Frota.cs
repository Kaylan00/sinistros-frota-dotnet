using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Models;

/// <summary>Motoboy da rede. Cadastro simples, sem regra de domínio própria.</summary>
public class Motorista
{
    public int Id { get; set; }
    public string Nome { get; set; } = "";
    public string Cpf { get; set; } = "";
    public string? Telefone { get; set; }
    public string Restaurante { get; set; } = "";
    public bool Ativo { get; set; } = true;
    public DateTime CriadoEm { get; set; }
    public List<Veiculo> Veiculos { get; set; } = [];
    public List<RegistroStatusMotorista> HistoricoStatus { get; set; } = [];
}

public class Veiculo
{
    public int Id { get; set; }
    public int MotoristaId { get; set; }
    public string Placa { get; set; } = "";
    public string Modelo { get; set; } = "";
    public short Ano { get; set; }
    public bool TemBau { get; set; } = true;
}

/// <summary>Uma linha do log de status (tabela StatusMotorista).</summary>
public class RegistroStatusMotorista
{
    public long Id { get; set; }
    public int MotoristaId { get; set; }
    public StatusMotorista Status { get; set; }
    public string? Observacao { get; set; }
    public DateTime RegistradoEm { get; set; }
}

public class SinistroHistorico
{
    public long Id { get; set; }
    public int SinistroId { get; set; }
    public StatusSinistro? StatusAnterior { get; set; }
    public StatusSinistro StatusNovo { get; set; }
    public string? Observacao { get; set; }
    public string Usuario { get; set; } = "";
    public DateTime AlteradoEm { get; set; }
}
