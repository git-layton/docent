import { X } from 'lucide-react';
import { IntegrationsDashboard } from './IntegrationsDashboard';

export function IntegrationsModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 bg-base/80 backdrop-blur-sm z-[200] animate-in fade-in" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-base border border-edge rounded-3xl shadow-2xl z-[201] p-8 animate-in zoom-in-95 fade-in">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-wash transition-colors z-10"
        >
          <X className="w-5 h-5 text-ink-3" />
        </button>
        <IntegrationsDashboard />
      </div>
    </>
  );
}
