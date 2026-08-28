import React, { useState, useRef, useEffect } from 'react';
import { Menu, Bell, ChevronDown, User, Settings, LogOut, CheckCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Logo } from './Logo';
import { useDatabase } from '../context/DatabaseContext';

interface HeaderProps {
  onMenuClick: () => void;
  onLogout?: () => void;
  onNavigate?: (view: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ onMenuClick, onLogout, onNavigate }) => {
  const { currentUser, getUserNotifications, markNotificationsRead } = useDatabase();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  
  const notifications = getUserNotifications();
  const unreadCount = notifications.filter(n => !n.read).length;

  const profileRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNotifClick = () => {
      setIsNotifOpen(!isNotifOpen);
      if (unreadCount > 0) markNotificationsRead();
  };

  const handleProfileNavigation = (view: string) => {
      if (onNavigate) onNavigate(view);
      setIsProfileOpen(false);
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 lg:px-8 fixed top-0 right-0 left-0 lg:left-64 z-30 transition-all duration-300 shadow-sm">
      <div className="flex items-center gap-4">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          <Menu size={24} />
        </button>
        
        {/* Breadcrumb or Brand Context */}
        <div className="hidden md:flex items-center gap-2 text-slate-400 text-sm">
          <span className="font-bold text-[#0F172A] tracking-wide">LINCOIN</span>
          <span className="text-slate-300">/</span>
          <span className="font-medium text-slate-600">Empresas</span>
        </div>
      </div>

      <div className="flex items-center gap-4 md:gap-6">
        
        {/* Notifications */}
        <div className="relative" ref={notifRef}>
            <button 
                onClick={handleNotifClick} 
                className={`relative p-2 rounded-full transition-colors ${isNotifOpen ? 'bg-slate-50 text-[#0F172A]' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
                    {unreadCount}
                    </span>
                )}
            </button>

            {isNotifOpen && (
                <div className="absolute top-full right-[-60px] md:right-0 mt-3 w-80 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 origin-top-right z-50">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <span className="font-bold text-slate-800 text-sm">Notificaciones</span>
                        <span className="text-[10px] text-slate-500 font-medium">Recientes</span>
                    </div>
                    <div className="max-h-80 overflow-y-auto">
                        {notifications.length > 0 ? notifications.slice(0, 5).map(n => (
                            <div key={n.id} className="p-4 border-b border-slate-50 hover:bg-slate-50 transition-colors flex gap-3">
                                <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${n.type === 'success' ? 'bg-green-500' : n.type === 'error' ? 'bg-red-500' : 'bg-slate-500'}`}></div>
                                <div>
                                    <p className="font-bold text-xs text-slate-800 mb-0.5">{n.title}</p>
                                    <p className="text-xs text-slate-500 leading-relaxed">{n.message}</p>
                                    <p className="text-[9px] text-slate-400 mt-1">{n.date}</p>
                                </div>
                            </div>
                        )) : (
                            <div className="p-8 text-center text-slate-400">
                                <div className="bg-slate-50 w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2">
                                    <Bell size={16} className="opacity-50"/>
                                </div>
                                <p className="text-xs">No tienes notificaciones nuevas</p>
                            </div>
                        )}
                    </div>
                    <div className="p-2 border-t border-slate-100 text-center">
                        <button className="text-[10px] font-bold text-[#0F172A] hover:underline">Ver todas</button>
                    </div>
                </div>
            )}
        </div>

        <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>

        {/* User Profile */}
        <div className="relative" ref={profileRef}>
            <div 
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className={`flex items-center gap-3 cursor-pointer p-1.5 pr-3 rounded-full border border-transparent transition-all ${isProfileOpen ? 'bg-slate-50 border-slate-200' : 'hover:bg-slate-50 hover:border-slate-200'}`}
            >
                <div className="w-9 h-9 rounded-full bg-[#0F172A] text-white flex items-center justify-center font-bold text-xs border-2 border-[#2DD4BF] overflow-hidden">
                    {currentUser?.avatarUrl ? (
                        <img src={currentUser.avatarUrl} alt="Logo" className="w-full h-full object-cover" />
                    ) : (
                        currentUser?.companyName?.substring(0, 2).toUpperCase() || 'EM'
                    )}
                </div>
                <div className="hidden sm:block text-right">
                    <p className="text-xs font-bold text-slate-800 leading-tight max-w-[120px] truncate">
                        {currentUser?.companyName || currentUser?.name || 'Empresa'}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono">
                        {currentUser?.taxId || '@EMPRESA001'}
                    </p>
                </div>
                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-200 ${isProfileOpen ? 'rotate-180 text-[#0F172A]' : ''}`} />
            </div>

            {/* Profile Dropdown */}
            {isProfileOpen && (
                <div className="absolute top-full right-0 mt-3 w-64 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 origin-top-right z-50">
                    <div className="p-4 border-b border-slate-50 bg-[#F8FAFC]">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Cuenta Empresa</p>
                        <p className="text-sm font-bold text-[#0F172A] truncate">{currentUser?.companyName}</p>
                        <p className="text-xs text-slate-500 truncate">{currentUser?.email}</p>
                    </div>
                    
                    <div className="p-2 space-y-1">
                        <button 
                            onClick={() => handleProfileNavigation('profile')}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg text-slate-600 text-sm font-medium transition-colors group"
                        >
                            <User size={18} className="text-slate-400 group-hover:text-[#0F172A]"/> Mi Perfil
                        </button>
                        <button 
                            onClick={() => handleProfileNavigation('profile')}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 rounded-lg text-slate-600 text-sm font-medium transition-colors group"
                        >
                            <Settings size={18} className="text-slate-400 group-hover:text-[#0F172A]"/> Configuración
                        </button>
                    </div>

                    <div className="p-2 border-t border-slate-100">
                        <button 
                            onClick={() => { if(onLogout) onLogout(); }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-red-50 text-red-600 rounded-lg text-sm font-medium transition-colors"
                        >
                            <LogOut size={18} /> Cerrar sesión
                        </button>
                    </div>
                </div>
            )}
        </div>

      </div>
    </header>
  );
};
