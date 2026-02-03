import { X, MoreHorizontal } from 'lucide-react';

interface HeaderProps {
  title?: string;
  onBack?: () => void;
}

export function Header({ title, onBack }: HeaderProps) {
  const tg = (window as any).Telegram?.WebApp;

  const handleClose = () => {
    if (onBack) {
      onBack();
    } else {
      tg?.close();
    }
  };

  return (
    <div className="flex justify-between items-center p-4 pt-6 safe-area-top text-white">
      <button 
        onClick={handleClose}
        className="bg-white/10 backdrop-blur-md p-2 rounded-2xl hover:bg-white/20 transition-colors border border-white/10"
      >
        <div className="flex items-center gap-1">
          <X size={20} />
          <span className="text-sm font-medium">Закрыть</span>
        </div>
      </button>
      
      {title && <h1 className="text-xl font-bold tracking-wide drop-shadow-lg">{title}</h1>}

      <button className="bg-white/10 backdrop-blur-md p-2 rounded-2xl hover:bg-white/20 transition-colors border border-white/10">
        <MoreHorizontal size={24} />
      </button>
    </div>
  );
}