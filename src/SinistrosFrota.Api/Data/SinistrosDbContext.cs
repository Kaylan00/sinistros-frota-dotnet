using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using SinistrosFrota.Api.Models;
using SinistrosFrota.Domain.Models;

namespace SinistrosFrota.Api.Data;

/// <summary>
/// O schema é dono dos scripts em database/ (não há migrations do EF).
/// O EF aqui só mapeia o que já existe: leitura, cadastro simples e as views.
/// Mudança de status de sinistro passa pelas procedures (ver SinistroService).
/// </summary>
public class SinistrosDbContext(DbContextOptions<SinistrosDbContext> options) : DbContext(options)
{
    public DbSet<Motorista> Motoristas => Set<Motorista>();
    public DbSet<Veiculo> Veiculos => Set<Veiculo>();
    public DbSet<Apolice> Apolices => Set<Apolice>();
    public DbSet<Sinistro> Sinistros => Set<Sinistro>();
    public DbSet<SinistroHistorico> SinistroHistorico => Set<SinistroHistorico>();
    public DbSet<RegistroStatusMotorista> StatusMotorista => Set<RegistroStatusMotorista>();

    public DbSet<MotoristaStatusAtual> MotoristasStatusAtual => Set<MotoristaStatusAtual>();
    public DbSet<SinistroEmAberto> SinistrosEmAberto => Set<SinistroEmAberto>();
    public DbSet<ResumoSinistrosMes> ResumoSinistrosPorMes => Set<ResumoSinistrosMes>();

    protected override void ConfigureConventions(ModelConfigurationBuilder b)
    {
        // Banco grava em UTC; marcar Kind=Utc faz o JSON sair com "Z" e o navegador converte para a hora local.
        b.Properties<DateTime>().HaveConversion<UtcConverter>();
        b.Properties<DateTime?>().HaveConversion<UtcConverter>();
        b.Properties<decimal>().HavePrecision(12, 2);
        // Enums gravados como texto, iguais aos CHECKs das tabelas
        b.Properties<StatusSinistro>().HaveConversion<string>().HaveMaxLength(10);
        b.Properties<TipoSinistro>().HaveConversion<string>().HaveMaxLength(12);
        b.Properties<StatusMotorista>().HaveConversion<string>().HaveMaxLength(10);
    }

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<Motorista>(e =>
        {
            e.ToTable("Motoristas");
            e.Property(x => x.Cpf).IsFixedLength().HasMaxLength(11);
            e.Property(x => x.CriadoEm).HasDefaultValueSql("SYSUTCDATETIME()");
            e.HasMany(x => x.Veiculos).WithOne().HasForeignKey(v => v.MotoristaId);
            e.HasMany(x => x.HistoricoStatus).WithOne().HasForeignKey(r => r.MotoristaId);
        });

        m.Entity<Veiculo>(e =>
        {
            e.ToTable("Veiculos");
            e.Property(x => x.Placa).IsFixedLength().HasMaxLength(7);
        });

        m.Entity<Apolice>(e =>
        {
            e.ToTable("Apolices");
            e.Property(x => x.FranquiaPercentual).HasPrecision(5, 2);
        });

        m.Entity<Sinistro>().ToTable("Sinistros");

        m.Entity<SinistroHistorico>(e =>
        {
            e.ToTable("SinistroHistorico");
            e.Property(x => x.AlteradoEm).HasDefaultValueSql("SYSUTCDATETIME()");
        });

        m.Entity<RegistroStatusMotorista>(e =>
        {
            e.ToTable("StatusMotorista");
            e.Property(x => x.RegistradoEm).HasDefaultValueSql("SYSUTCDATETIME()");
        });

        m.Entity<MotoristaStatusAtual>().HasNoKey().ToView("vw_MotoristasStatusAtual");
        m.Entity<SinistroEmAberto>().HasNoKey().ToView("vw_SinistrosEmAberto");
        m.Entity<ResumoSinistrosMes>().HasNoKey().ToView("vw_ResumoSinistrosPorMes");
    }

    private sealed class UtcConverter() : ValueConverter<DateTime, DateTime>(
        v => v.Kind == DateTimeKind.Utc ? v : v.ToUniversalTime(),
        v => DateTime.SpecifyKind(v, DateTimeKind.Utc));
}
