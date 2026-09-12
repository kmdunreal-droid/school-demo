import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BookOpen, Users, Award, Shield, ArrowRight, CheckCircle2, 
  MapPin, Phone, Mail, Clock, Calendar, Sparkles, Send, Info,
  GraduationCap, Laptop, Book, Globe, ShieldCheck, Trophy,
  Menu, X, Star, Quote, TrendingUp, CheckSquare, CreditCard, MessageSquare, Fingerprint
} from 'lucide-react';
import { Teacher, Student, Class } from '../types';
import schoolHero from '../assets/images/school_hero_illustration_1781185991035.png';

interface LandingPageProps {
  teachers: Teacher[];
  students: Student[];
  classes: Class[];
  onEnterPortal: () => void;
}

export default function LandingPage({ teachers, students, classes, onEnterPortal }: LandingPageProps) {
  // Mobile nav state
  const [mobileOpen, setMobileOpen] = useState(false);

  // Inquiry form states
  const [studentName, setStudentName] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [selectedGrade, setSelectedGrade] = useState('Grade 9');
  const [messageText, setMessageText] = useState('');
  const [inquirySubmitted, setInquirySubmitted] = useState(false);

  const handleInquirySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentName.trim() || !parentPhone.trim()) {
      alert('Please fill in Student Name and Contact Phone number.');
      return;
    }
    setInquirySubmitted(true);
    // Auto-reset after a moment
    setTimeout(() => {
      setInquirySubmitted(false);
      setStudentName('');
      setParentEmail('');
      setParentPhone('');
      setMessageText('');
    }, 5000);
  };

  const navItems = ['Home', 'Academics', 'Mentors', 'Admissions'];

  const handleNavClick = (id: string) => {
    setMobileOpen(false);
    document.getElementById(id.toLowerCase())?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="bg-white text-slate-900 font-sans antialiased min-h-screen flex flex-col selection:bg-amber-100 selection:text-amber-900 overflow-x-hidden">
      
      {/* ========== MODERN NAVIGATION ========== */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-4 sm:px-6 md:px-12 py-3 sm:py-4 flex items-center justify-between">
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3"
        >
          <img 
            src="/logo.png" 
            alt="Demo School" 
            className="h-9 sm:h-10 w-auto object-contain hover:scale-105 transition-transform"
            referrerPolicy="no-referrer"
          />
          <div className="flex flex-col">
            <span className="font-black text-slate-950 text-lg sm:text-xl tracking-tighter uppercase leading-none">
              Demo
            </span>
            <span className="text-[10px] tracking-[0.4em] font-black text-amber-600 uppercase">
              School
            </span>
          </div>
        </motion.div>

        {/* Desktop Navbar */}
        <nav className="hidden lg:flex items-center gap-10 text-[10px] font-black text-slate-400 uppercase tracking-[0.25em]">
          {navItems.map((item) => (
            <a 
              key={item}
              href={`#${item.toLowerCase()}`} 
              onClick={(e) => { e.preventDefault(); handleNavClick(item.toLowerCase()); }}
              className="hover:text-amber-600 transition-all relative group cursor-pointer"
            >
              {item}
              <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-amber-600 transition-all group-hover:w-full"></span>
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02, translateY: -1 }}
            whileTap={{ scale: 0.98 }}
            onClick={onEnterPortal}
            className="hidden sm:block py-3 px-6 md:px-8 bg-slate-950 text-white font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer shadow-xl shadow-slate-200 hover:bg-amber-600 hover:shadow-amber-200"
          >
            Portal Login
          </motion.button>

          {/* Mobile Hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="lg:hidden fixed top-[60px] left-0 right-0 z-40 bg-white border-b border-slate-100 shadow-2xl shadow-slate-200/50 px-6 py-6 space-y-4 max-h-[calc(100vh-60px)] overflow-y-auto"
          >
            {navItems.map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase()}`}
                onClick={(e) => { e.preventDefault(); handleNavClick(item.toLowerCase()); }}
                className="block py-3 px-4 rounded-xl text-[11px] font-black text-slate-700 uppercase tracking-[0.25em] hover:bg-amber-50 hover:text-amber-700 transition-colors cursor-pointer"
              >
                {item}
              </a>
            ))}
            <button
              onClick={() => { setMobileOpen(false); onEnterPortal(); }}
              className="w-full py-4 mt-2 bg-slate-950 text-white font-black text-[11px] uppercase tracking-widest hover:bg-amber-600 transition-colors cursor-pointer"
            >
              Portal Login
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <main>
        {/* ========== MODERN HERO SECTION ========== */}
        <section id="home" className="relative pt-10 sm:pt-14 md:pt-16 pb-14 md:pb-20 px-4 sm:px-6 md:px-12 overflow-hidden">
          {/* Refined Background Elements */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-7xl -z-10 overflow-hidden pointer-events-none">
            <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-amber-50/60 rounded-full blur-[120px]"></div>
            <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-slate-50 rounded-full blur-[100px]"></div>
            <div className="absolute top-1/3 left-1/4 w-40 h-40 bg-amber-100/40 rounded-full blur-3xl"></div>
          </div>

          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              <motion.div 
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-8 md:space-y-10 text-center"
              >
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-100 rounded-full">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-[10px] font-black text-amber-600 uppercase tracking-[0.2em]">Excellence Redefined</span>
                </div>

                <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-black tracking-tighter leading-[0.95] text-slate-950 uppercase">
                  Shaping<br/>
                  <span className="text-amber-600">The Future</span><br/>
                  of Leaders.
                </h1>
                
                <p className="text-slate-500 text-base sm:text-lg md:text-xl max-w-xl leading-relaxed font-medium mx-auto">
                  Demo School integrates rigorous academic standards with advanced digital systems, fostering an environment where curiosity meets modern capability.
                </p>

                <div className="flex flex-col sm:flex-row gap-4 md:gap-5 pt-4 sm:pt-6 max-w-md sm:max-w-none mx-auto">
                  <motion.button
                    whileHover={{ scale: 1.05, translateY: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onEnterPortal}
                    className="px-8 sm:px-12 py-4 md:py-5 bg-amber-600 text-white font-black text-[11px] uppercase tracking-[0.4em] transition-all shadow-2xl shadow-amber-200 flex items-center justify-center gap-2"
                  >
                    Enter Portal
                    <ArrowRight size={14} />
                  </motion.button>
                  <motion.a
                    whileHover={{ scale: 1.05, translateY: -2 }}
                    whileTap={{ scale: 0.98 }}
                    href="#academics"
                    onClick={(e) => { e.preventDefault(); handleNavClick('academics'); }}
                    className="px-8 sm:px-12 py-4 md:py-5 border-2 border-slate-950 text-slate-950 hover:bg-slate-950 hover:text-white font-black text-[11px] uppercase tracking-[0.4em] transition-all flex items-center justify-center"
                  >
                    View Programs
                  </motion.a>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 1, delay: 0.2 }}
                className="relative"
              >
                <div className="aspect-square w-full bg-slate-50 rounded-[2rem] md:rounded-[4rem] border border-slate-100 overflow-hidden relative shadow-2xl">
                  <div className="absolute inset-0 bg-gradient-to-tr from-amber-100/20 to-transparent"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <img 
                      src={schoolHero} 
                      alt="Demo School Features" 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>

                  {/* School Features Overlay Chips */}
                  <div className="absolute left-4 bottom-4 sm:left-6 sm:bottom-6 flex flex-wrap gap-2 max-w-[85%]">
                    {[
                      { icon: CheckSquare, label: 'Digital Attendance' },
                      { icon: Calendar, label: 'Smart Timetable' },
                      { icon: CreditCard, label: 'Fee Ledger' },
                      { icon: MessageSquare, label: 'WhatsApp Alerts' },
                      { icon: Award, label: 'Live Results' },
                      { icon: Fingerprint, label: 'ID Cards' }
                    ].map(feat => (
                      <span key={feat.label} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white/90 backdrop-blur-md border border-amber-100 text-slate-900 rounded-full shadow-md text-[9px] font-black uppercase tracking-widest">
                        <feat.icon size={11} className="text-amber-600" />
                        {feat.label}
                      </span>
                    ))}
                  </div>

                  {/* Floating Feature Cards */}
                  <motion.div 
                    animate={{ y: [0, -10, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="absolute top-4 right-4 sm:top-10 sm:right-10 bg-white p-4 sm:p-5 shadow-xl rounded-2xl border border-slate-100 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-600 text-white rounded-xl flex items-center justify-center shrink-0">
                      <CheckCircle2 size={18} />
                    </div>
                    <div>
                      <div className="text-amber-600 font-black text-sm sm:text-lg">98%</div>
                      <div className="text-[8px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-widest">Board Pass Rate</div>
                    </div>
                  </motion.div>

                  <motion.div 
                    animate={{ y: [0, 10, 0] }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
                    className="absolute bottom-24 left-2 sm:bottom-28 sm:left-[-20px] bg-slate-950 p-4 sm:p-5 shadow-xl rounded-2xl border border-slate-800 flex items-center gap-3"
                  >
                    <div className="w-8 h-8 sm:w-10 sm:h-10 bg-amber-600/20 text-amber-400 rounded-xl flex items-center justify-center shrink-0">
                      <TrendingUp size={18} />
                    </div>
                    <div>
                      <div className="text-white font-black text-sm sm:text-lg">12+</div>
                      <div className="text-[8px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest">Specialized Labs</div>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ========== TRUST STRIP ========== */}
        <section className="bg-slate-950 py-8 md:py-10 px-4 sm:px-6 md:px-12">
          <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { icon: Shield, label: 'Safe Campus', sub: '24/7 Security' },
              { icon: Award, label: 'Certified Faculty', sub: 'Advanced Credentials' },
              { icon: TrendingUp, label: 'Digital Ledger', sub: 'Real-time Tracking' },
              { icon: GraduationCap, label: 'Global Curriculum', sub: 'Modern Standards' }
            ].map((item, idx) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.08 }}
                className="flex items-center gap-3 justify-center"
              >
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-amber-600/20 rounded-xl flex items-center justify-center shrink-0">
                  <item.icon size={18} className="text-amber-400" />
                </div>
                <div className="text-left">
                  <div className="text-white font-black text-xs sm:text-sm uppercase tracking-wider">{item.label}</div>
                  <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">{item.sub}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ========== ACADEMIC BENTO GRID ========== */}
        <section id="academics" className="py-12 md:py-16 px-4 sm:px-6 md:px-12 bg-slate-50">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-10 md:mb-12 mx-auto max-w-3xl">
                <h2 className="text-amber-600 text-[10px] font-black uppercase tracking-[0.5em] mb-4">Academic Streams</h2>
                <h3 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-950 uppercase tracking-tighter leading-tight">
                  Curated Programs for<br/>Every Stage of Growth.
                </h3>
                <p className="text-slate-500 font-medium mx-auto mt-6 text-sm leading-relaxed max-w-md">
                  From foundational primary education to advanced matriculation prep, we provide the environment for students to excel.
                </p>
              </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Primary - Large Bento Item */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="md:col-span-8 bg-white p-8 sm:p-10 border border-slate-100 shadow-sm hover:shadow-xl transition-all relative overflow-hidden group min-h-[320px] sm:min-h-[400px] flex flex-col justify-between"
              >
                <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-amber-50 rounded-full group-hover:scale-110 transition-transform duration-500"></div>
                <div className="relative z-10">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-amber-600 text-white rounded-2xl flex items-center justify-center mb-6 sm:mb-10 shadow-lg shadow-amber-100">
                    <BookOpen size={24} />
                  </div>
                  <h4 className="text-2xl sm:text-3xl font-black text-slate-950 uppercase tracking-tighter mb-4">Primary Foundation</h4>
                  <p className="text-slate-500 text-base sm:text-lg leading-relaxed max-w-md">
                    Cultivating literacy, numeracy, and critical thinking skills in a vibrant, supportive environment for Grades 1 through 8.
                  </p>
                </div>
                <div className="relative z-10 flex flex-wrap items-center gap-6">
                  <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest bg-amber-50 px-4 py-2 rounded-full">Grades 1-8</span>
                  <div className="flex -space-x-3">
                    {[1,2,3,4].map(i => (
                      <div key={i} className="w-10 h-10 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center text-[10px] font-bold">
                        {String.fromCharCode(64 + i)}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>

              {/* Secondary - Tall Bento Item */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="md:col-span-4 bg-slate-950 p-8 sm:p-10 shadow-2xl relative overflow-hidden group min-h-[320px] sm:min-h-[400px] flex flex-col justify-between"
              >
                <div className="absolute inset-0 bg-amber-600/10 group-hover:bg-amber-600/20 transition-colors"></div>
                <div className="relative z-10">
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white text-slate-950 rounded-2xl flex items-center justify-center mb-6 sm:mb-10">
                    <ShieldCheck size={24} />
                  </div>
                  <h4 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tighter mb-4">Secondary Excellence</h4>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                    Intensive matriculation preparation with a focus on science, mathematics, and high-performance laboratory work.
                  </p>
                </div>
                <div className="relative z-10">
                  <div className="text-amber-400 text-[10px] font-black uppercase tracking-widest mb-4">Science / Arts Streams</div>
                  <button className="flex items-center gap-2 text-white text-[10px] font-black uppercase tracking-[0.2em] hover:text-amber-400 transition-colors cursor-pointer">
                    Explore Matrix <ArrowRight size={14} />
                  </button>
                </div>
              </motion.div>

              {/* Academy - Third Bento Item */}
              <motion.div 
                whileHover={{ y: -5 }}
                className="md:col-span-12 bg-amber-600 p-8 sm:p-10 shadow-xl relative overflow-hidden group min-h-[240px] sm:min-h-[300px] flex items-center"
              >
                <div className="absolute right-0 bottom-0 p-6 sm:p-10 opacity-10 rotate-12 group-hover:rotate-0 transition-transform duration-700 hidden sm:block">
                  <Trophy size={220} strokeWidth={1} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center relative z-10 w-full">
                  <div className="space-y-4 sm:space-y-6">
                    <h4 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tighter">Demo Academy Prep</h4>
                    <p className="text-amber-50 text-base sm:text-lg leading-relaxed max-w-md">
                      Specialized evening coaching designed for conceptual mastery and top-tier board exam results.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Computer'].map(sub => (
                      <div key={sub} className="px-4 sm:px-6 py-2.5 sm:py-3 bg-white/10 backdrop-blur-md border border-white/20 text-white rounded-xl text-[10px] font-black uppercase tracking-widest">
                        {sub}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ========== THE MENTORSHIP WALL ========== */}
        <section id="mentors" className="py-12 md:py-16 px-4 sm:px-6 md:px-12 bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-10 md:mb-14">
              <h2 className="text-amber-600 text-[10px] font-black uppercase tracking-[0.5em] mb-4">Our Commitment</h2>
              <h3 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-950 uppercase tracking-tighter leading-tight">
                Pedagogical Excellence.
              </h3>
              <p className="text-slate-500 font-medium mt-6 text-sm max-w-2xl mx-auto leading-relaxed">
                Three pillars that power every classroom at Demo School — from verified expertise to technology-driven learning experiences.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
              {[
                { 
                  title: 'Certified Academics', 
                  desc: 'Faculty members hold advanced credentials and undergo rigorous pedagogical training cycles for mastery in every subject.', 
                  icon: Award, 
                  accent: 'emerald',
                  soft: 'bg-amber-50 border-amber-200 text-amber-700',
                  chip: 'bg-amber-600',
                  features: ['100% Qualified Staff', 'Continuous PD Cycles', 'Subject Specialists']
                },
                { 
                  title: 'Mentorship Focus', 
                  desc: 'Each student is assigned a personal academic mentor to track holistic development — academically and personally.', 
                  icon: Users, 
                  accent: 'indigo',
                  soft: 'bg-teal-50 border-teal-200 text-teal-700',
                  chip: 'bg-teal-600',
                  features: ['1:1 Mentorship', 'Progress Reviews', 'Parent Counselor Links']
                },
                { 
                  title: 'Tech-First Learning', 
                  desc: 'Integrating smart classroom technology for an interactive, data-driven experience that prepares students for a digital future.', 
                  icon: Laptop, 
                  accent: 'rose',
                  soft: 'bg-rose-50 border-rose-200 text-rose-700',
                  chip: 'bg-rose-600',
                  features: ['Smart Classrooms', 'Digital Attendance', 'Live Result Portal']
                }
              ].map((item, idx) => (
                <motion.div 
                  key={item.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  whileHover={{ y: -8 }}
                  className="group relative bg-slate-50 border border-slate-100 rounded-[1.75rem] p-8 overflow-hidden hover:shadow-2xl hover:shadow-slate-200/60 transition-all duration-500 text-center flex flex-col"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                  <div className="mb-7 relative mx-auto">
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-lg ${item.chip} group-hover:scale-110 group-hover:-rotate-6 transition-all duration-500`}>
                      <item.icon size={28} />
                    </div>
                  </div>
                  <h4 className="text-lg font-black text-slate-950 uppercase tracking-tighter mb-4">{item.title}</h4>
                  <p className="text-slate-500 text-sm leading-relaxed mb-6 font-medium flex-1">
                    {item.desc}
                  </p>
                  <div className="flex flex-wrap gap-2 justify-center mb-6">
                    {item.features.map(f => (
                      <span key={f} className={`px-3 py-1.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${item.soft}`}>
                        {f}
                      </span>
                    ))}
                  </div>
                  <div className="h-1 w-12 bg-slate-200 rounded-full mx-auto group-hover:w-full group-hover:bg-amber-600 transition-all duration-500"></div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ========== DIRECTORY METRICS ========== */}
        <section className="bg-slate-50 py-10 md:py-16 px-4 sm:px-6 md:px-12 border-y border-slate-100">
          <div className="max-w-7xl mx-auto">
            <div className="grid grid-cols-3 gap-4 md:gap-12">
              {[
                { label: 'Faculty Members', val: teachers.length, icon: GraduationCap },
                { label: 'Students Enrolled', val: students.length, icon: Users },
                { label: 'Active Classrooms', val: classes.length, icon: Globe }
              ].map((stat) => (
                <div key={stat.label} className="flex flex-col items-center text-center space-y-2 sm:space-y-4">
                  <div className="text-slate-200 hidden sm:block"><stat.icon size={48} strokeWidth={1} /></div>
                  <div className="text-2xl sm:text-5xl font-black text-slate-950 tracking-tighter">{stat.val}</div>
                  <div className="text-[8px] sm:text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ========== PREMIUM ADMISSION PORTAL (FORM) ========== */}
        <section id="admissions" className="py-12 md:py-16 px-4 sm:px-6 md:px-12 bg-white relative overflow-hidden">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-center">
            
            <div className="lg:col-span-5 space-y-8 text-center">
              <div className="inline-block px-4 py-1.5 bg-amber-50 text-amber-600 text-[11px] font-black uppercase tracking-widest rounded-full">
                Session 2026-27 Open
              </div>
              <h2 className="text-3xl sm:text-4xl md:text-5xl font-black text-slate-950 uppercase tracking-tighter leading-tight">
                Secure Your Path<br/>to Academic Success.
              </h2>
              <p className="text-slate-500 text-base sm:text-lg leading-relaxed font-medium">
                Submit an inquiry today to receive our comprehensive digital prospectus and fee structure blueprints.
              </p>

              <div className="space-y-6 pt-6">
                {[
                  { icon: Phone, label: 'Principal Office', val: '+92 (051) demo-school' },
                  { icon: Mail, label: 'Inquiry Support', val: 'queries@demo-school.edu' },
                  { icon: MapPin, label: 'Campus Address', val: 'Demo School Building, Academy Blvd, PK' }
                ].map(info => (
                  <div key={info.label} className="flex items-center justify-center gap-5">
                    <div className="w-10 h-10 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-center text-slate-900 shadow-sm shrink-0">
                      <info.icon size={18} />
                    </div>
                    <div>
                      <div className="text-[11px] font-black text-slate-400 uppercase tracking-widest">{info.label}</div>
                      <div className="text-sm font-bold text-slate-950">{info.val}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="lg:col-span-7">
              <motion.div 
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                className="bg-white border border-slate-100 shadow-2xl p-6 sm:p-10 md:p-12 relative"
              >
                <div className="absolute top-0 left-0 w-2 h-full bg-amber-600"></div>
                
                <div className="mb-8 sm:mb-10">
                  <h3 className="text-xl sm:text-2xl font-black text-slate-950 uppercase tracking-tighter mb-2">Digital Inquiry Portal</h3>
                  <p className="text-slate-400 text-xs uppercase tracking-widest font-bold">Registration & Information Request</p>
                </div>

                {inquirySubmitted ? (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-amber-50 border border-amber-100 p-8 sm:p-12 text-center space-y-6"
                  >
                    <div className="w-16 h-16 sm:w-20 sm:h-20 bg-amber-600 text-white rounded-full flex items-center justify-center mx-auto shadow-xl shadow-amber-100">
                      <CheckCircle2 size={32} />
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-lg sm:text-xl font-black text-amber-600 uppercase tracking-tighter">Inquiry Received</h4>
                      <p className="text-sm text-amber-700 font-medium">
                        Thank you for your interest. Our admissions counselor will contact you shortly to guide you through the enrollment matrix.
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <form onSubmit={handleInquirySubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Student Complete Name</label>
                        <input
                          type="text"
                          required
                          placeholder="John Doe"
                          value={studentName}
                          onChange={(e) => setStudentName(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 focus:border-amber-500 focus:bg-white p-4 text-xs font-bold outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Parent Contact Index</label>
                        <input
                          type="tel"
                          required
                          placeholder="+92 3XX XXXXXXX"
                          value={parentPhone}
                          onChange={(e) => setParentPhone(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-100 focus:border-amber-500 focus:bg-white p-4 text-xs font-bold outline-none transition-all"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Admission Grade</label>
                      <select
                        value={selectedGrade}
                        onChange={(e) => setSelectedGrade(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 focus:border-amber-500 focus:bg-white p-4 text-xs font-bold outline-none cursor-pointer transition-all appearance-none"
                      >
                        <option value="Prep">Kindergarten / Prep</option>
                        <option value="Primary">Primary (1 - 5)</option>
                        <option value="Middle">Middle (6 - 8)</option>
                        <option value="Secondary">Secondary (9 - 10)</option>
                        <option value="Academy">Evening Academy</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Additional Requirements</label>
                      <textarea
                        rows={4}
                        placeholder="Specify custom requirements or subject preferences..."
                        value={messageText}
                        onChange={(e) => setMessageText(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-100 focus:border-amber-500 focus:bg-white p-4 text-xs font-bold outline-none transition-all resize-none"
                      />
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.01, translateY: -2 }}
                      whileTap={{ scale: 0.99 }}
                      type="submit"
                      className="w-full py-4 sm:py-5 bg-slate-950 text-white font-black text-[11px] uppercase tracking-[0.4em] transition-all flex items-center justify-center gap-3 hover:bg-amber-600 shadow-2xl"
                    >
                      Process Inquiry
                      <Send size={14} />
                    </motion.button>
                  </form>
                )}
              </motion.div>
            </div>
          </div>
        </section>
      </main>

      {/* ========== MODERN FOOTER ========== */}
      <footer className="bg-slate-950 text-white py-16 md:py-20 px-4 sm:px-6 md:px-12 border-t border-slate-900">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 md:gap-16 mb-16 md:mb-20">
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <img src="/logo.png" alt="Demo School Logo" className="h-12 w-auto object-contain rounded-lg bg-white p-1.5 shadow-lg" referrerPolicy="no-referrer" />
                <span className="font-black text-xl tracking-tighter uppercase">Demo School</span>
              </div>
              <p className="text-slate-500 text-xs leading-relaxed font-bold uppercase tracking-wider">
                Developing Scholars, Creating Legacies since 2012. We are committed to nurturing the next generation of global citizens.
              </p>
            </div>
            
            <div className="space-y-6">
              <h5 className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500">Navigation</h5>
              <ul className="space-y-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <li><button onClick={() => handleNavClick('home')} className="hover:text-white transition-colors cursor-pointer">Home Campus</button></li>
                <li><button onClick={() => handleNavClick('academics')} className="hover:text-white transition-colors cursor-pointer">Curriculum</button></li>
                <li><button onClick={() => handleNavClick('mentors')} className="hover:text-white transition-colors cursor-pointer">Faculty</button></li>
                <li><button onClick={() => handleNavClick('admissions')} className="hover:text-white transition-colors cursor-pointer">Enrolment</button></li>
              </ul>
            </div>

            <div className="space-y-6">
              <h5 className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500">Portals</h5>
              <ul className="space-y-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <li><button onClick={onEnterPortal} className="hover:text-white transition-colors text-left uppercase cursor-pointer">Principal Dashboard</button></li>
                <li><button onClick={onEnterPortal} className="hover:text-white transition-colors text-left uppercase cursor-pointer">Faculty Portal</button></li>
                <li><button onClick={onEnterPortal} className="hover:text-white transition-colors text-left uppercase cursor-pointer">Student Campus</button></li>
              </ul>
            </div>

            <div className="space-y-6">
              <h5 className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500">Connect</h5>
              <div className="flex gap-4">
                {[Phone, Mail, Globe].map((Icon, i) => (
                  <div key={i} className="w-10 h-10 bg-slate-900 border border-slate-800 rounded-lg flex items-center justify-center text-slate-400 hover:bg-amber-600 hover:text-white transition-all cursor-pointer">
                    <Icon size={18} />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-10 border-t border-slate-900 flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-[10px] sm:text-[11px] font-black uppercase tracking-[0.4em] text-slate-600 text-center">
              © 2012-2026 Principal Campus Management Center.
            </p>
            <div className="flex gap-8 text-[11px] font-black uppercase tracking-[0.4em] text-slate-600">
              <a href="#" className="hover:text-white">Privacy</a>
              <a href="#" className="hover:text-white">Terms</a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
