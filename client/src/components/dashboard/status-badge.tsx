import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusConfig: Record<string, { label: string; className: string }> = {
  ligado: {
    label: "Ligado",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  desligado: {
    label: "Desligado",
    className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  },
  successes: {
    label: "Sucesso",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  successes_partial: {
    label: "Sucesso Parcial",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
  erro: {
    label: "Erro",
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  },
  url_inválida: {
    label: "URL Inválida",
    className: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  },
  processado: {
    label: "Processado",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  "não processado": {
    label: "Não Processado",
    className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  },
  publicado: {
    label: "Publicado",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  "não publicado": {
    label: "Não Publicado",
    className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  },
  published: {
    label: "Publicado",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  },
  draft: {
    label: "Rascunho",
    className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  },
  archived: {
    label: "Arquivado",
    className: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] || {
    label: status,
    className: "bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20",
  };

  return (
    <Badge
      variant="outline"
      className={cn("font-medium", config.className, className)}
      data-testid={`status-badge-${status}`}
    >
      {config.label}
    </Badge>
  );
}
