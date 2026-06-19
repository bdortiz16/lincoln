import React, { createContext, useContext, useEffect, useState } from "react";
import * as SecureStore from "expo-secure-store";

export interface User {
  id: string;
  name: string;
  email: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SESSION_KEY = "lincoln.session";

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Demo auth. Sessions are persisted locally with expo-secure-store.
 * Replace signIn/signUp with real API calls when wiring a backend.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(SESSION_KEY);
        if (raw) setUser(JSON.parse(raw));
      } catch {
        // ignore — treat as logged out
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function persist(u: User | null) {
    setUser(u);
    if (u) await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(u));
    else await SecureStore.deleteItemAsync(SESSION_KEY);
  }

  async function signIn(email: string, _password: string) {
    // Demo: accept any credentials and derive a name from the email.
    const name = email.split("@")[0] || "Usuario";
    await persist({ id: "u_" + Date.now(), name, email });
  }

  async function signUp(name: string, email: string, _password: string) {
    await persist({ id: "u_" + Date.now(), name, email });
  }

  async function signOut() {
    await persist(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
