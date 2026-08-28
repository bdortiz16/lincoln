import React from 'react';
import {
  Home,
  Send,
  RefreshCw,
  Activity,
  LogOut,
  Users,
  Megaphone,
  PieChart,
  Settings,
  HelpCircle,
  Landmark
} from 'lucide-react';
import { Logo } from './Logo';
import { useSystemConfig } from '../context/SystemConfigContext';

interface SidebarProps {
  isOpen: boolean;
  activeView: string;
  onNavigate: (view: string) => void;
  onLogout: () => void;
}

const MenuGroup: React.FC<{ title?: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mb-6 px-4">
    {title && <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 pl-2">{title}</h4>}
    <div className="space-y-1">
      {children}
    </div>
  </div>
);

const MenuItem: React.FC<{ 
  icon: React.ElementType; 
  label: string; 
  id: string;
  isActive?: boolean; 
  badge?: string;
  onClick: () => void;
}> = ({ icon: Icon, label, isActive, badge, onClick }) => {
  return (
    <button 
      onClick={onClick}
      className={`
        w-full flex items-center justify-between px-3 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden
        ${isActive 
          ? 'bg-[#4ADE80] text-[#0C0E0D] font-bold shadow-lg shadow-green-900/10' 
          : 'text-slate-400 hover:bg-white/5 hover:text-white font-medium'}
      `}
    >
      <div className="flex items-center gap-3 z-10">
        <Icon size={20} className={isActive ? 'text-[#0C0E0D]' : 'text-slate-400 group-hover:text-white'} />
        <span className="text-sm">{label}</span>
      </div>
      
      {badge && (
        <span className={`
          px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full z-10
          ${isActive ? 'bg-[#0C0E0D]/10 text-[#0C0E0D]' : 'bg-red-500 text-white'}
        `}>
          {badge}
        </span>
      )}
    </button>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, activeView, onNavigate, onLogout }) => {
  const { config } = useSystemConfig();
  const seasonEmoji = config.seasonEmojis && config.seasonEmojis.length > 0 ? config.seasonEmojis[0] : null;

  return (
    <aside 
      className={`
        fixed top-0 left-0 z-40 h-screen bg-[#0C0E0D] border-r border-white/5 transition-transform duration-300
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:w-64 flex flex-col shadow-2xl
      `}
      style={{ backgroundColor: config.themeColor }}
    >
      <div className="h-20 flex items-center px-6 border-b border-white/5">
        <Logo variant="white" business />
        {seasonEmoji && <span className="ml-2 text-xl">{seasonEmoji}</span>}
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll py-6">
        <MenuGroup title="Principal">
          <MenuItem icon={Home} label="Resumen" id="dashboard" isActive={activeView === 'dashboard'} onClick={() => onNavigate('dashboard')} />
          <MenuItem icon={Activity} label="Movimientos" id="movements" isActive={activeView === 'movements'} onClick={() => onNavigate('movements')} />
        </MenuGroup>

        <MenuGroup title="Operaciones">
          <MenuItem icon={Send} label="Enviar Dinero" id="enviar" isActive={activeView === 'enviar'} onClick={() => onNavigate('enviar')} />
          <MenuItem icon={RefreshCw} label="Convertir" id="convertir" isActive={activeView === 'convertir'} onClick={() => onNavigate('convertir')} />
          <MenuItem icon={Landmark} label="Dispersiones" id="mouv" isActive={activeView === 'mouv'} onClick={() => onNavigate('mouv')} />
        </MenuGroup>

        <MenuGroup title="Cuenta">
          <MenuItem icon={Users} label="Invita y Gana" id="referrals" isActive={activeView === 'referrals'} onClick={() => onNavigate('referrals')} badge="$20" />
          <MenuItem icon={Settings} label="Configuración" id="profile" isActive={activeView === 'profile'} onClick={() => onNavigate('profile')} />
        </MenuGroup>
      </div>

      <div className="p-4 border-t border-white/5" style={{ backgroundColor: config.themeColor }}>
        <button 
          onClick={onLogout}
          className="flex items-center gap-3 px-4 py-3 w-full text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all text-sm font-medium"
        >
          <LogOut size={18} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </aside>
  );
};