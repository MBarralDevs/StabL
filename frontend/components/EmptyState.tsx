import { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: {
    label: string;
    href: string;
  };
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="px-6 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-surface-overlay flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <h3 className="text-sm font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-xs text-text-muted max-w-sm mx-auto leading-relaxed">{description}</p>
      {action && (
        <a
          href={action.href}
          className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-hover transition-colors"
        >
          {action.label}
        </a>
      )}
    </div>
  );
}