
import React, { useState, useRef, useEffect } from 'react';
import { Logo } from './Logo';
import { 
    UserCheck, 
    Building2, 
    FileText, 
    UploadCloud, 
    FileCheck, 
    ArrowLeft, 
    CheckCircle,
    Smartphone,
    ScanFace,
    ChevronDown,
    Info,
    ChevronRight,
    Edit2,
    Check,
    Upload,
    Trash2,
    AlertCircle
} from 'lucide-react';
import { useDatabase, UserDocuments } from '../context/DatabaseContext';

interface OnboardingWizardProps {
  onFinish: () => void;
}

const steps = [
  { id: 1, label: "Validación de identidad del Representante Legal", icon: UserCheck },
  { id: 2, label: "Datos generales de la empresa", icon: Building2 },
  { id: 3, label: "Declaración jurada de beneficiarios finales", icon: FileText },
  { id: 4, label: "Adjuntar documentación", icon: UploadCloud },
  { id: 5, label: "Resumen", icon: FileCheck },
];

const allCountriesList = [
    "Colombia", "Perú", "Chile", "México", "Brasil", "Argentina", "Estados Unidos", "España", "Panamá", "Ecuador"
];

// Reusable File Upload Component
const FileUploadField: React.FC<{ 
    label: string; 
    subLabel?: string;
    value: string | null; 
    onChange: (base64: string | null) => void; 
    accept?: string;
}> = ({ label, subLabel, value, onChange, accept = "image/*,.pdf" }) => {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                onChange(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div 
            onClick={() => inputRef.current?.click()}
            className={`border border-slate-300 rounded-lg h-16 flex items-center justify-between px-4 bg-white cursor-pointer transition-colors group relative ${value ? 'border-green-500 bg-green-50' : 'hover:border-[#0F172A]'}`}
        >
            <input 
                type="file" 
                ref={inputRef}
                className="hidden" 
                accept={accept}
                onChange={handleFileChange}
            />
            <div className="flex flex-col justify-center">
                <span className={`text-sm font-medium ${value ? 'text-green-700' : 'text-slate-600 group-hover:text-[#0F172A]'}`}>
                    {value ? "Archivo cargado" : label}
                </span>
                {subLabel && !value && <span className="text-[10px] text-slate-400">{subLabel}</span>}
            </div>
            
            {value ? (
                <div className="flex items-center gap-2">
                    <CheckCircle className="text-green-500" size={20} />
                    <button 
                        onClick={(e) => { e.stopPropagation(); onChange(null); if(inputRef.current) inputRef.current.value = ''; }}
                        className="p-1 hover:bg-red-100 rounded-full text-slate-400 hover:text-red-500"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>
            ) : (
                <Upload className="text-[#0F172A]" size={20} />
            )}
        </div>
    );
};

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onFinish }) => {
  const [viewMode, setViewMode] = useState<'hub' | 'form'>('hub');
  const [currentStep, setCurrentStep] = useState(1);
  const [step1SubState, setStep1SubState] = useState(0); // 0: Form, 1: Pre-AML, 2: AML Modal
  const [showAmlModal, setShowAmlModal] = useState(false);
  const [modalStage, setModalStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { currentUser, updateUserProfile } = useDatabase();

  // --- FORM STATE ---
  const [formData, setFormData] = useState({
      // Rep Legal
      repGender: '',
      repDob: '',
      repFirstName: '',
      repLastName: '',
      repNationality: '',
      repDocCountry: '',
      repDocType: '',
      repDocNumber: '',
      isPep: null as boolean | null,
      multiSign: null as boolean | null,
      
      // Company
      companyName: currentUser?.companyName || '',
      companyCountry: currentUser?.country || '',
      companyTaxIdType: '',
      companyTaxId: currentUser?.taxId || '',
      companyRegion: '',
      companyCity: '',
      companyAddress: '',

      // Beneficiaries
      affidavitAccepted: false,

      // Documents (Base64 strings)
      docRepId: null as string | null,
      docConstitution: null as string | null,
      docTaxId: null as string | null
  });

  useEffect(() => {
    window.scrollTo(0, 0);
    setError(null);
  }, [currentStep, viewMode, step1SubState]);

  const handleChange = (field: string, value: any) => {
      setFormData(prev => ({ ...prev, [field]: value }));
      if (error) setError(null);
  };

  const validateStep = (step: number, subStep: number = 0) => {
      // Step 1: Legal Rep
      if (step === 1 && subStep === 0) {
          if (!formData.repGender) return "Selecciona el género.";
          if (!formData.repDob) return "Ingresa la fecha de nacimiento.";
          if (!formData.repFirstName || !formData.repLastName) return "Ingresa el nombre completo.";
          if (!formData.repNationality) return "Selecciona la nacionalidad.";
          if (!formData.repDocCountry) return "Selecciona el país de emisión del documento.";
          if (!formData.repDocType) return "Selecciona el tipo de documento.";
          if (!formData.repDocNumber) return "Ingresa el número de documento.";
          if (formData.isPep === null) return "Responde si eres una persona políticamente expuesta.";
      }

      // Step 2: Company
      if (step === 2) {
          if (!formData.companyName) return "Ingresa la Razón Social.";
          if (!formData.companyCountry) return "Selecciona el país de la empresa.";
          if (!formData.companyTaxIdType) return "Selecciona el tipo de identificación tributaria.";
          if (!formData.companyTaxId) return "Ingresa el número de identificación tributaria.";
          if (!formData.companyCity) return "Ingresa la ciudad.";
          if (!formData.companyAddress) return "Ingresa la dirección legal.";
      }

      // Step 3: Beneficiaries
      if (step === 3) {
          if (!formData.affidavitAccepted) return "Debes aceptar la declaración jurada.";
      }

      // Step 4: Documents
      if (step === 4) {
          if (!formData.docRepId) return "Debes cargar el documento de identidad del representante.";
          if (!formData.docConstitution) return "Debes cargar la constitución de la empresa.";
      }

      return null; // Valid
  };

  const handleStartStep = () => {
    setViewMode('form');
  };

  const handleNextInForm = async () => {
    // Validate current step before proceeding
    const validationError = validateStep(currentStep, step1SubState);
    if (validationError) {
        setError(validationError);
        // Scroll to error
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    if (currentStep === 1) {
        if (step1SubState < 1) {
            setStep1SubState(prev => prev + 1);
        } else {
            setShowAmlModal(true);
        }
    } else if (currentStep < 5) {
        setCurrentStep(prev => prev + 1);
    } else {
        // FINAL SAVE
        if (currentUser) {
            const docs: UserDocuments = {
                repId: formData.docRepId || undefined,
                constitution: formData.docConstitution || undefined,
                rut: formData.docTaxId || undefined,
                affidavit: formData.affidavitAccepted ? 'signed' : undefined
            };

            await updateUserProfile(currentUser.id, {
                kycStatus: 'in_review',
                name: formData.companyName,
                companyName: formData.companyName,
                country: formData.companyCountry,
                companyCountry: formData.companyCountry,
                companyCity: formData.companyCity,
                companyAddress: formData.companyAddress,
                address: `${formData.companyAddress}, ${formData.companyCity}`,
                taxId: formData.companyTaxId,
                taxIdType: formData.companyTaxIdType,
                repLegalName: `${formData.repFirstName} ${formData.repLastName}`,
                repFirstName: formData.repFirstName,
                repLastName: formData.repLastName,
                repDob: formData.repDob,
                repNationality: formData.repNationality,
                repDocType: formData.repDocType,
                repDocNumber: formData.repDocNumber,
                repDocCountry: formData.repDocCountry,
                isPep: formData.isPep,
                documents: docs,
            });
            setCurrentStep(6); // Success screen
        }
    }
  };

  const handleBackInForm = () => {
    if (currentStep === 1 && step1SubState > 0) {
        setStep1SubState(prev => prev - 1);
    } else if (currentStep > 1) {
        setCurrentStep(prev => prev - 1);
    } else {
        setViewMode('hub');
    }
  };

  const handleModalStart = () => {
    setModalStage(1);
    // Simulate biometric check
    setTimeout(() => {
        setShowAmlModal(false);
        setCurrentStep(2); 
        setModalStage(0);
    }, 2500);
  };

  // --- RENDERERS ---

  if (viewMode === 'hub') {
    return (
      <div className="min-h-screen bg-[#F4F6F9] flex flex-col items-center p-4">
        <header className="w-full max-w-6xl py-6 flex justify-between items-center">
            <Logo />
            <div className="text-sm font-bold text-slate-500">{currentUser?.email}</div>
        </header>

        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row min-h-[500px] mt-8">
            <div className="md:w-5/12 bg-[#0F172A] p-8 text-white relative">
                 <div className="space-y-0 relative z-10">
                    {steps.map((s, idx) => {
                        const isCurrent = s.id === currentStep;
                        const isCompleted = s.id < currentStep;
                        return (
                            <div key={s.id} className="flex gap-4 group min-h-[60px]">
                                <div className="flex flex-col items-center">
                                    <div className={`w-3 h-3 rounded-full z-10 flex items-center justify-center ${isCurrent ? 'bg-cuypay-accent scale-125' : isCompleted ? 'bg-cuypay-accent/50' : 'bg-white/20'}`}></div>
                                    {idx !== steps.length - 1 && (<div className={`w-0.5 flex-1 my-1 ${isCompleted ? 'bg-cuypay-accent/30' : 'bg-white/10'}`}></div>)}
                                </div>
                                <div className={`pb-6 text-sm font-medium ${isCurrent ? 'text-white' : 'text-green-200/50'}`}>{s.label}</div>
                            </div>
                        );
                    })}
                 </div>
                 <div className="absolute bottom-0 right-0 w-64 h-64 bg-slate-500/10 rounded-full blur-3xl pointer-events-none"></div>
            </div>

            <div className="md:w-7/12 p-12 flex flex-col justify-center">
                 <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-[#0F172A] mb-6 border border-slate-200">
                    {steps.find(s => s.id === currentStep)?.icon ? React.createElement(steps.find(s => s.id === currentStep)!.icon, { size: 32 }) : <UserCheck size={32} />}
                 </div>
                 <h2 className="text-2xl font-bold text-[#0F172A] mb-2">{steps.find(s => s.id === currentStep)?.label}</h2>
                 <p className="text-slate-500 mb-8 leading-relaxed">Complete la información requerida para habilitar su cuenta empresa.</p>
                 <button onClick={handleStartStep} className="w-fit px-8 py-3 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg shadow-green-900/20 transition-all">
                    {currentStep === 1 ? "Comenzar registro" : "Continuar"}
                 </button>
            </div>
        </div>
      </div>
    );
  }

  if (currentStep === 6) {
      return (
        <div className="min-h-screen bg-white flex flex-col">
            <header className="h-16 px-8 flex items-center border-b border-slate-100">
                <div className="scale-90 origin-left"><Logo /></div>
            </header>
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-in fade-in zoom-in duration-500">
                <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6 relative">
                    <div className="w-20 h-20 bg-[#5d87ff] rounded-full flex items-center justify-center shadow-lg">
                        <Check className="text-white w-10 h-10" strokeWidth={3} />
                    </div>
                </div>
                <h2 className="text-xl text-slate-800 font-bold mb-1">¡Felicidades!</h2>
                <h1 className="text-2xl text-[#0F172A] font-bold mb-4">La empresa {formData.companyName} fue registrada con éxito</h1>
                <p className="text-slate-500 max-w-lg mb-12 leading-relaxed">
                    Validaremos la documentación enviada y dentro de las próximas 24 horas hábiles te notificaremos para que puedas operar en LINCOIN.
                </p>
                <button onClick={onFinish} className="w-full max-w-xs h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg shadow-green-900/20 transition-all">Ir al inicio</button>
            </div>
        </div>
      );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
        <header className="h-20 px-4 md:px-8 flex items-center justify-between border-b border-slate-100 bg-white sticky top-0 z-20">
            <div className="flex items-center gap-4">
                <div className="hidden md:block scale-90 origin-left"><Logo /></div>
                <div className="md:hidden scale-75 origin-left"><Logo collapsed /></div>
                <button onClick={handleBackInForm} className="flex items-center text-slate-400 hover:text-[#0F172A] transition-colors ml-2">
                    <ArrowLeft size={20} />
                </button>
            </div>
            <div className="hidden md:block w-1/3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-[#0F172A] transition-all duration-500" style={{ width: `${(currentStep / 5) * 100}%` }}></div>
            </div>
            <button onClick={() => setViewMode('hub')} className="px-4 py-2 text-sm font-medium text-[#0F172A] border border-[#0F172A] rounded-lg hover:bg-slate-50 transition-colors">Guardar y Salir</button>
        </header>

        <div className="flex-1 overflow-y-auto bg-white">
            <div className="max-w-3xl mx-auto p-6 md:p-12 animate-in fade-in slide-in-from-right-4 duration-500">
                
                {error && (
                    <div className="mb-6 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg flex items-center gap-2 text-sm font-medium animate-in slide-in-from-top-2">
                        <AlertCircle size={18} /> {error}
                    </div>
                )}

                {/* STEP 1: LEGAL REP FORM */}
                {currentStep === 1 && step1SubState === 0 && (
                    <>
                        <h2 className="text-2xl font-bold text-[#0F172A] text-center mb-2">Datos del Representante Legal</h2>
                        <p className="text-center text-slate-500 mb-10">Completa los datos de la persona que administrará la cuenta.</p>
                        
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-[#0F172A] mb-4 flex items-center gap-2">Datos personales</h3>
                                <div className="flex gap-4 mb-4">
                                    <button onClick={() => handleChange('repGender', 'male')} className={`flex-1 h-12 border font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors ${formData.repGender === 'male' ? 'border-[#0F172A] bg-slate-50 text-[#0F172A]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}><span>♂</span> Masculino</button>
                                    <button onClick={() => handleChange('repGender', 'female')} className={`flex-1 h-12 border font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors ${formData.repGender === 'female' ? 'border-[#0F172A] bg-slate-50 text-[#0F172A]' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}><span>♀</span> Femenino</button>
                                </div>
                                <div className="relative mb-4">
                                    <input type="date" value={formData.repDob} onChange={(e) => handleChange('repDob', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg text-slate-900 focus:border-[#0F172A] outline-none" />
                                    <label className="absolute left-4 -top-2.5 bg-white px-1 text-xs text-[#0F172A] font-bold">Fecha de nacimiento</label>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <input type="text" placeholder="Nombres" value={formData.repFirstName} onChange={(e) => handleChange('repFirstName', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg focus:border-[#0F172A] outline-none" />
                                    <input type="text" placeholder="Apellidos" value={formData.repLastName} onChange={(e) => handleChange('repLastName', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg focus:border-[#0F172A] outline-none" />
                                </div>
                                <div className="relative mt-4">
                                    <select value={formData.repNationality} onChange={(e) => handleChange('repNationality', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg bg-white appearance-none focus:border-[#0F172A] outline-none">
                                        <option value="">Selecciona Nacionalidad</option>
                                        {allCountriesList.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-4 top-4 text-slate-400 pointer-events-none" size={16} />
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold text-[#0F172A] mb-4">Datos de identificación</h3>
                                <div className="relative mb-4">
                                    <select value={formData.repDocCountry} onChange={(e) => handleChange('repDocCountry', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg bg-white appearance-none focus:border-[#0F172A] outline-none">
                                        <option value="">País emisión del documento</option>
                                        {allCountriesList.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-4 top-4 text-slate-400 pointer-events-none" size={16} />
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="relative">
                                        <select value={formData.repDocType} onChange={(e) => handleChange('repDocType', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg bg-white appearance-none focus:border-[#0F172A] outline-none">
                                            <option value="">Tipo Documento</option>
                                            <option value="DNI">DNI / Cédula</option>
                                            <option value="PASSPORT">Pasaporte</option>
                                            <option value="CE">Carné Extranjería</option>
                                        </select>
                                        <ChevronDown className="absolute right-4 top-4 text-slate-400 pointer-events-none" size={16} />
                                    </div>
                                    <input type="text" placeholder="N° de Identificación" value={formData.repDocNumber} onChange={(e) => handleChange('repDocNumber', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg focus:border-[#0F172A] outline-none" />
                                </div>
                            </div>
                            
                             <div>
                                <h3 className="text-sm font-bold text-[#0F172A] mb-2">¿Eres una persona políticamente expuesta?</h3>
                                <div className="flex gap-6 mb-4">
                                     <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name="pep" checked={formData.isPep === true} onChange={() => handleChange('isPep', true)} className="w-4 h-4 text-[#0F172A]" /> Si
                                     </label>
                                     <label className="flex items-center gap-2 cursor-pointer">
                                        <input type="radio" name="pep" checked={formData.isPep === false} onChange={() => handleChange('isPep', false)} className="w-4 h-4 text-[#0F172A]" /> No
                                     </label>
                                </div>
                            </div>

                            <div className="pt-4 flex justify-center pb-8">
                                <button onClick={handleNextInForm} className="w-full max-w-sm h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg transition-all">Continuar</button>
                            </div>
                        </div>
                    </>
                )}

                {/* STEP 1: PRE-AML */}
                {currentStep === 1 && step1SubState === 1 && (
                     <div className="flex flex-col items-center text-center mt-8 max-w-lg mx-auto">
                        <div className="relative w-48 h-48 mb-8">
                            <div className="absolute inset-0 bg-slate-100 rounded-full animate-pulse opacity-50"></div>
                            <div className="relative z-10 flex flex-col items-center justify-center h-full">
                                <Smartphone size={100} className="text-[#0F172A]" strokeWidth={1} />
                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/80 p-2 rounded-lg border border-cuypay-accent shadow-sm">
                                    <ScanFace size={40} className="text-cuypay-accent" />
                                </div>
                            </div>
                        </div>
                        <h2 className="text-2xl font-bold text-[#0F172A] mb-4">Validación Biométrica</h2>
                        <p className="text-slate-500 mb-8">Para tu seguridad, necesitamos verificar que eres quien dices ser.</p>
                        <button onClick={handleNextInForm} className="w-full max-w-xs h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg transition-all">Iniciar Verificación</button>
                    </div>
                )}

                {/* STEP 2: COMPANY DATA */}
                {currentStep === 2 && (
                    <>
                        <h2 className="text-2xl font-bold text-[#0F172A] text-center mb-2">Datos de la empresa</h2>
                        <p className="text-center text-slate-500 mb-10">Completa los siguientes datos para identificar la empresa.</p>

                        <div className="space-y-6">
                            <div>
                                <h3 className="text-sm font-bold text-[#0F172A] mb-4">Identificación</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <input type="text" placeholder="Razón Social" value={formData.companyName} onChange={(e) => handleChange('companyName', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg focus:border-[#0F172A] outline-none" />
                                    <div className="relative">
                                         <select value={formData.companyCountry} onChange={(e) => handleChange('companyCountry', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg bg-white appearance-none focus:border-[#0F172A] outline-none">
                                            <option value="">País de la Empresa</option>
                                            {allCountriesList.map(c => <option key={c} value={c}>{c}</option>)}
                                         </select>
                                         <ChevronDown className="absolute right-4 top-4 text-slate-400 pointer-events-none" size={16} />
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                     <div className="relative">
                                        <select value={formData.companyTaxIdType} onChange={(e) => handleChange('companyTaxIdType', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg bg-white appearance-none focus:border-[#0F172A] outline-none">
                                            <option value="">Tipo ID Tributario</option>
                                            <option value="RUC">RUC</option>
                                            <option value="NIT">NIT</option>
                                            <option value="RUT">RUT</option>
                                            <option value="EIN">EIN</option>
                                            <option value="CNPJ">CNPJ</option>
                                        </select>
                                        <ChevronDown className="absolute right-4 top-4 text-slate-400 pointer-events-none" size={16} />
                                    </div>
                                    <input type="text" placeholder="N° Identificación (RUC/NIT)" value={formData.companyTaxId} onChange={(e) => handleChange('companyTaxId', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg focus:border-[#0F172A] outline-none" />
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-bold text-[#0F172A] mb-4">Dirección legal</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                    <input type="text" placeholder="Ciudad" value={formData.companyCity} onChange={(e) => handleChange('companyCity', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg focus:border-[#0F172A] outline-none" />
                                    <input type="text" placeholder="Dirección Exacta" value={formData.companyAddress} onChange={(e) => handleChange('companyAddress', e.target.value)} className="w-full h-12 px-4 border border-slate-300 rounded-lg focus:border-[#0F172A] outline-none" />
                                </div>
                            </div>

                            <div className="pt-8 flex justify-center pb-8">
                                <button onClick={handleNextInForm} className="w-full max-w-sm h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg transition-all">Continuar</button>
                            </div>
                        </div>
                    </>
                )}

                {/* STEP 3: BENEFICIARIES */}
                {currentStep === 3 && (
                    <>
                        <h2 className="text-2xl font-bold text-[#0F172A] text-center mb-10">Declaración jurada</h2>
                        <div className="space-y-4">
                            <div className="bg-[#EBF2FA] rounded-lg p-6 border border-slate-200">
                                <h4 className="font-bold text-[#0F172A] mb-4">Beneficiarios Finales</h4>
                                <p className="text-sm text-slate-600 mb-4">Declaro que la información proporcionada es fidedigna y que los beneficiarios finales de la empresa han sido identificados correctamente.</p>
                                <div className="flex items-start gap-3 mt-4">
                                    <input type="checkbox" id="dj" checked={formData.affidavitAccepted} onChange={(e) => handleChange('affidavitAccepted', e.target.checked)} className="mt-1 w-5 h-5 rounded border-slate-300 text-[#0F172A] focus:ring-[#0F172A]" />
                                    <label htmlFor="dj" className="text-sm text-slate-700 font-medium">Acepto la declaración jurada de veracidad de la información.</label>
                                </div>
                            </div>
                            <div className="pt-8 flex justify-center pb-8">
                                <button onClick={handleNextInForm} className="w-full max-w-sm h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg transition-all">Continuar</button>
                            </div>
                        </div>
                    </>
                )}

                {/* STEP 4: DOCUMENTS */}
                {currentStep === 4 && (
                    <>
                        <h2 className="text-2xl font-bold text-[#0F172A] text-center mb-2">Documentos de la empresa</h2>
                        <p className="text-center text-slate-500 mb-8">Sube los documentos legales para validar tu empresa.</p>
                        
                        <div className="space-y-6">
                            <div>
                                <h3 className="text-[#0F172A] font-bold text-sm mb-2">Documento ID Representante Legal</h3>
                                <FileUploadField 
                                    label="Cargar Cédula / Pasaporte" 
                                    value={formData.docRepId} 
                                    onChange={(val) => handleChange('docRepId', val)} 
                                />
                            </div>
                            
                            <div>
                                <h3 className="text-[#0F172A] font-bold text-sm mb-2">Constitución de la Empresa</h3>
                                <FileUploadField 
                                    label="Cargar Escritura / Cámara de Comercio" 
                                    value={formData.docConstitution} 
                                    onChange={(val) => handleChange('docConstitution', val)} 
                                />
                            </div>

                            <div>
                                <h3 className="text-[#0F172A] font-bold text-sm mb-2">RUT / Tax ID (Opcional)</h3>
                                <FileUploadField 
                                    label="Cargar Documento Tributario" 
                                    value={formData.docTaxId} 
                                    onChange={(val) => handleChange('docTaxId', val)} 
                                />
                            </div>

                            <div className="pt-8 flex justify-center pb-8">
                                <button onClick={handleNextInForm} className="w-full max-w-sm h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg transition-all">Finalizar Registro</button>
                            </div>
                        </div>
                    </>
                )}

                {/* STEP 5: REVIEW */}
                {currentStep === 5 && (
                    <>
                        <h2 className="text-2xl font-bold text-[#0F172A] text-center mb-6">Revisar Datos</h2>
                        <div className="space-y-6 bg-slate-50 p-6 rounded-xl border border-slate-200">
                            <div>
                                <h4 className="text-xs font-bold text-slate-400 uppercase mb-1">Empresa</h4>
                                <p className="text-lg font-bold text-slate-800">{formData.companyName}</p>
                                <p className="text-sm text-slate-600">{formData.companyTaxIdType}: {formData.companyTaxId}</p>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-slate-400 uppercase mb-1">Representante Legal</h4>
                                <p className="text-lg font-bold text-slate-800">{formData.repFirstName} {formData.repLastName}</p>
                                <p className="text-sm text-slate-600">{formData.repDocType}: {formData.repDocNumber}</p>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-slate-400 uppercase mb-1">Documentos Cargados</h4>
                                <div className="flex gap-2 mt-2">
                                    {formData.docRepId && <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded font-bold">ID Rep.</span>}
                                    {formData.docConstitution && <span className="bg-green-100 text-green-700 text-xs px-2 py-1 rounded font-bold">Constitución</span>}
                                </div>
                            </div>
                        </div>
                        <div className="pt-8 flex justify-center pb-8">
                            <button onClick={handleNextInForm} className="w-full max-w-sm h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg shadow-lg transition-all">Confirmar y Enviar</button>
                        </div>
                    </>
                )}

            </div>
        </div>

        {/* AML Modal overlay */}
        {showAmlModal && (
            <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-lg min-h-[400px] rounded-xl shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in-95">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                        <button onClick={() => setShowAmlModal(false)} className="text-slate-400 hover:text-slate-600"><ArrowLeft size={24} /></button>
                        <span className="text-slate-500 font-bold tracking-widest text-xs uppercase">Biometría</span>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                        {modalStage === 0 ? (
                            <>
                                <ScanFace size={64} className="text-[#0F172A] mb-4"/>
                                <h2 className="text-2xl font-bold text-slate-800 mb-2">Escaneo Facial</h2>
                                <p className="text-slate-500 mb-8 text-sm">Por favor, mantén tu rostro dentro del marco y sigue las instrucciones.</p>
                                <button onClick={handleModalStart} className="w-full max-w-xs h-12 bg-[#0F172A] hover:bg-[#152e52] font-bold rounded-lg transition-colors">Escanear Ahora</button>
                            </>
                        ) : (
                            <div className="flex flex-col items-center">
                                <div className="w-16 h-16 border-4 border-slate-200 border-t-green-500 rounded-full animate-spin mb-6"></div>
                                <h3 className="text-xl font-bold text-slate-800">Verificando identidad...</h3>
                                <p className="text-slate-400 text-sm mt-2">Esto tomará unos segundos</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};
