import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Circle, Chrome, Github, Eye, EyeOff } from "lucide-react";

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.15, delayChildren: 0.2 },
  },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export default function App() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="flex min-h-screen w-full bg-black selection:bg-white/30 p-2 transition-all duration-500 lg:h-screen lg:overflow-hidden lg:p-4">
      {/* ---------- Left Column · Hero ---------- */}
      <div className="hidden lg:flex w-[52%] relative flex-col items-center justify-end pb-32 px-12 rounded-3xl overflow-hidden shadow-2xl h-full">
        {/* Animated aurora fallback — sits BEHIND the video so the hero never
            looks empty if the source fails to load (no overlay over the video). */}
        <div className="aurora-fallback absolute inset-0" />
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source
            src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260506_081238_406ed0e3-5d83-436e-a512-0bbff7ec5b95.mp4"
            type="video/mp4"
          />
        </video>

        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="z-10 w-full max-w-xs space-y-8"
        >
          {/* Brand / Logo */}
          <motion.div
            variants={item}
            className="flex items-center justify-center gap-2"
          >
            <Circle className="w-5 h-5 fill-white text-white" />
            <span className="text-xl font-semibold tracking-tight">Aurora</span>
          </motion.div>

          {/* Heading block */}
          <motion.div variants={item} className="space-y-3 text-center">
            <h1 className="text-4xl font-medium tracking-tight whitespace-nowrap">
              Join Aurora
            </h1>
            <p className="text-white/60 text-sm leading-relaxed px-4">
              Follow these 3 quick phases to activate your space.
            </p>
          </motion.div>

          {/* Steps */}
          <motion.div variants={item} className="space-y-3">
            <StepItem number={1} text="Register your identity" active />
            <StepItem number={2} text="Configure your studio" />
            <StepItem number={3} text="Finalize your profile" />
          </motion.div>
        </motion.div>
      </div>

      {/* ---------- Right Column · Sign Up Form ---------- */}
      <div className="flex-1 flex flex-col items-center justify-center py-12 lg:py-6 px-4 sm:px-12 lg:px-16 xl:px-24 overflow-y-auto lg:overflow-hidden">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="w-full max-w-xl space-y-8 lg:space-y-6 sm:space-y-10"
        >
          {/* Header */}
          <div className="space-y-2">
            <h2 className="text-3xl font-medium tracking-tight">
              Create New Profile
            </h2>
            <p className="text-white/40 text-sm">
              Input your basic details to begin the journey.
            </p>
          </div>

          {/* Social buttons */}
          <div className="grid grid-cols-2 gap-4">
            <SocialButton icon={<Chrome className="w-5 h-5" />} label="Google" />
            <SocialButton icon={<Github className="w-5 h-5" />} label="Github" />
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-black px-4 text-xs font-medium text-white/40 uppercase tracking-widest">
                Or
              </span>
            </div>
          </div>

          {/* Form */}
          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <div className="grid grid-cols-2 gap-4">
              <InputGroup label="First Name" placeholder="Jane" type="text" />
              <InputGroup label="Last Name" placeholder="Doe" type="text" />
            </div>

            <InputGroup label="Email" placeholder="jane@studio.com" type="email" />

            {/* Password with toggle */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-white">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="w-full bg-brand-gray border-none rounded-xl h-11 px-4 pr-11 text-white placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-xs text-white/30">
                Requires at least 8 symbols.
              </p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="w-full h-14 bg-white text-black font-semibold rounded-xl hover:bg-white/90 active:scale-[0.98] transition-all mt-4"
            >
              Create Account
            </button>
          </form>

          {/* Footer link */}
          <p className="text-center text-sm text-white/40">
            Member of the team?{" "}
            <a href="#" className="text-white font-medium hover:underline">
              Log in
            </a>
          </p>
        </motion.div>
      </div>
    </main>
  );
}

/* ----------------------------- Components ----------------------------- */

function StepItem({
  number,
  text,
  active = false,
}: {
  number: number;
  text: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-2xl transition-all ${
        active
          ? "bg-white text-black border border-white"
          : "bg-brand-gray text-white border-none"
      }`}
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          active ? "bg-black text-white" : "bg-white/10 text-white/40"
        }`}
      >
        {number}
      </div>
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}

function SocialButton({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="flex h-12 items-center justify-center gap-2 bg-black border border-white/10 rounded-xl hover:bg-white/5 transition-colors text-sm font-medium"
    >
      {icon}
      {label}
    </button>
  );
}

function InputGroup({
  label,
  placeholder,
  type,
}: {
  label: string;
  placeholder: string;
  type: string;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-white">{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full bg-brand-gray border-none rounded-xl h-11 px-4 text-white placeholder:text-white/20 focus:ring-2 focus:ring-white/20 outline-none"
      />
    </div>
  );
}
