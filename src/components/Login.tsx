import React, { useState } from 'react';
import { GraduationCap, Mail, Lock, Eye, EyeOff, Shield, User, Users, AlertCircle } from 'lucide-react';
import { Role, UserSession, Teacher, Student, Coordinator } from '../types';
import { supabase } from '../supabase';
import { toast } from 'sonner';

interface LoginProps {
  teachers: Teacher[];
  students: Student[];
  coordinators: Coordinator[];
  onLogin: (session: UserSession) => void;
  onBackToLanding?: () => void;
}

export default function Login({ teachers, students, coordinators, onLogin, onBackToLanding }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const checkInput = email.trim().toLowerCase();

    if (!email.trim() || !password.trim()) {
      setError('Please fill in all fields.');
      return;
    }

    // 1. Check Developer (Superuser)
    if (checkInput === 'km' && password === '6016') {
      onLogin({
        role: 'developer',
        email: 'developer@nsb1.com',
        username: 'KM',
        name: 'System Developer',
      });
      toast.success("Developer Access Granted.");
      return;
    }

    // 2. Check Principal (Master Credentials)
    if (checkInput === 'ali' && password === '111222') {
      onLogin({
        role: 'principal',
        email: 'ali@nsb1.com',
        username: 'ali',
        name: 'Ali (Principal)',
      });
      toast.success("Principal Ali authenticated.");
      return;
    }

    // 3. Check Coordinators
    const foundCoordinator = coordinators.find(c => 
      c.name?.toLowerCase() === checkInput || 
      c.username?.toLowerCase() === checkInput ||
      c.id?.toLowerCase() === checkInput
    );
    if (foundCoordinator && password === foundCoordinator.password) {
      onLogin({
        role: 'coordinator',
        email: foundCoordinator.email || '',
        username: foundCoordinator.username || '',
        id: foundCoordinator.id,
        name: foundCoordinator.name,
      });
      toast.success(`Welcome Coordinator ${foundCoordinator.name}!`);
      return;
    }

    // 4. Check Faculty (Teachers)
    const foundTeacher = teachers.find(t => 
      t.name?.toLowerCase() === checkInput || 
      t.username?.toLowerCase() === checkInput ||
      t.id?.toLowerCase() === checkInput
    );
    if (foundTeacher && password === foundTeacher.password) {
      onLogin({
        role: 'teacher',
        email: foundTeacher.email || '',
        username: foundTeacher.username || '',
        id: foundTeacher.id,
        name: foundTeacher.name,
      });
      toast.success(`Welcome Faculty ${foundTeacher.name}!`);
      return;
    }

    // 5. Check Students
    const foundStudent = students.find(s => 
      s.email?.toLowerCase() === checkInput || 
      s.username?.toLowerCase() === checkInput ||
      s.id?.toLowerCase() === checkInput
    );
    if (foundStudent && password === foundStudent.password) {
      onLogin({
        role: 'student',
        email: foundStudent.email || '',
        username: foundStudent.username || '',
        id: foundStudent.id,
        name: foundStudent.name,
      });
      toast.success(`Welcome Student ${foundStudent.name}!`);
      return;
    }

    // 6. Fallback — Cloud Register (Supabase Auth) for generic Principal/Secure Admin
    try {
      const { data: cred, error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authErr) throw authErr;
      const user = cred.user;
      if (user && user.email) {
        onLogin({
          role: 'principal',
          email: user.email,
          username: user.email.split('@')[0],
          name: 'Principal Office',
        });
        toast.success("Authenticated via Cloud Register.");
        return;
      }
    } catch (err: any) {
      // If everything fails
      setError('Invalid ID or Password. Portal access denied.');
    }
  };

  return (
    <div id="login-container" className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-slate-950 px-6 font-sans border-t-8 border-slate-900 dark:border-teal-600 text-slate-900 dark:text-slate-100 transition-colors duration-200">
      <div className="w-full max-w-sm space-y-12">
        
        {/* Minimalist Header */}
        <div className="text-center space-y-4">
          <img 
            src="/logo.png" 
            alt="DEMO ACADEMY" 
            className="mx-auto h-20 w-auto object-contain mb-2"
            referrerPolicy="no-referrer"
          />
          <div className="space-y-1">
            <h2 id="login-title" className="text-3xl font-light tracking-tighter text-slate-950 dark:text-white uppercase  text-center">
              Portal <span className="font-extrabold not-">Login</span>
            </h2>
            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-[0.4em] text-center">
              Demo School
            </p>
          </div>
        </div>

        {/* Unified Form */}
        <form onSubmit={handleLogin} className="space-y-8">
          {error && (
            <div id="login-error" className="text-[10px] font-bold text-red-550 uppercase tracking-[0.2em] text-center bg-red-50 dark:bg-red-950/25 py-3 border border-red-100 dark:border-red-900/30">
              {error}
            </div>
          )}

          <div className="space-y-6">
            <div className="space-y-1">
              <input
                id="email-input"
                type="text"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ID, Username or Email"
                className="w-full bg-transparent border-b border-slate-200 dark:border-slate-800 py-4 text-[11px] font-bold tracking-[0.2em] focus:outline-none focus:border-teal-600 dark:focus:border-teal-500 text-slate-900 dark:text-white transition-all placeholder:text-slate-300 dark:placeholder:text-slate-650"
              />
            </div>

            <div className="space-y-1 relative">
              <input
                id="password-input"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full bg-transparent border-b border-slate-200 dark:border-slate-800 py-4 text-[11px] font-bold tracking-[0.2em] focus:outline-none focus:border-teal-600 dark:focus:border-teal-500 text-slate-900 dark:text-white transition-all placeholder:text-slate-300 dark:placeholder:text-slate-650"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-400 hover:text-teal-600 transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-4 pt-2">
            <button
              id="login-submit-btn"
              type="submit"
              className="w-full py-4 bg-slate-950 dark:bg-teal-600 hover:bg-slate-800 dark:hover:bg-teal-500 text-white font-bold text-[10px] uppercase tracking-[0.4em] transition-all cursor-pointer shadow-2xl"
            >
              Sign In to Portal
            </button>

            <div className="text-center">
              {onBackToLanding && (
                <button 
                  onClick={onBackToLanding}
                  className="text-[11px] font-bold text-slate-400 hover:text-slate-950 uppercase tracking-[0.2em] border-b border-slate-100 transition-all cursor-pointer"
                >
                  Return to Overview
                </button>
              )}
            </div>
          </div>
        </form>

        <div className="pt-8 border-t border-slate-50 dark:border-slate-900 text-center">
            <p className="text-[10px] font-bold text-slate-300 dark:text-slate-700 uppercase tracking-widest">
                Demo School Digital Management Infrastructure
            </p>
        </div>
      </div>
    </div>
  );
}
