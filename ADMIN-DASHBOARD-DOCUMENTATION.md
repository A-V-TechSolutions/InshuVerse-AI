# InshuVerse AI - Admin Dashboard Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [Setup Instructions](#setup-instructions)
6. [Firebase Configuration](#firebase-configuration)
7. [Authentication System](#authentication-system)
8. [Complete Code Content](#complete-code-content)
9. [Features Documentation](#features-documentation)
10. [Deployment Guide](#deployment-guide)

---

## Overview

The InshuVerse AI Admin Dashboard is a web-based application that allows administrators to manage users, plans, credits, and monitor application usage. It connects directly to the Firebase Firestore database used by the main InshuVerse AI application.

**Key Features:**
- User management (view, edit, delete users)
- Plan management (upgrade/downgrade user plans)
- Credit adjustment (add/remove credits)
- Usage analytics and statistics
- Real-time data synchronization
- Admin authentication and authorization

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Admin Dashboard (React)                    │
│  - User Interface (React Components)                          │
│  - State Management (React Hooks)                             │
│  - Routing (React Router)                                     │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                    Firebase SDK (Client)                       │
│  - Authentication (Admin sign-in)                             │
│  - Firestore (User data, plans, credits)                      │
│  - Real-time listeners                                        │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                    Firebase (Cloud)                           │
│  - Firestore Database                                         │
│  - Authentication Service                                    │
│  - Security Rules                                             │
└─────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. Admin signs in via Firebase Auth
2. Dashboard fetches user data from Firestore
3. Real-time listeners sync data changes
4. Admin actions (credit adjustment, plan change) update Firestore
5. Main InshuVerse AI app reads updated data from Firestore
6. Changes reflected immediately in desktop app

---

## Tech Stack

**Frontend Framework:**
- **React 18.2.0** - UI framework
- **React Router 6.20.0** - Client-side routing
- **Vite 5.0.0** - Build tool and dev server

**Styling:**
- **Tailwind CSS 3.4.0** - Utility-first CSS framework
- **Lucide React 0.294.0** - Icon library

**Data & Backend:**
- **Firebase 10.7.0** - Backend-as-a-Service
- **Firestore** - NoSQL database
- **Firebase Auth** - Authentication

**Data Visualization:**
- **Recharts 2.10.0** - Chart library for analytics

**Utilities:**
- **date-fns 2.30.0** - Date manipulation

---

## Project Structure

```
admin-dashboard/
├── public/
│   └── index.html              # HTML entry point
├── src/
│   ├── main.jsx                # React entry point
│   ├── App.jsx                 # Main app component
│   ├── index.css               # Global styles
│   │
│   ├── config/
│   │   └── firebase.js         # Firebase configuration
│   │
│   ├── context/
│   │   └── AuthContext.jsx     # Authentication context
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.jsx     # Navigation sidebar
│   │   │   ├── Header.jsx      # App header
│   │   │   └── Layout.jsx      # Main layout wrapper
│   │   │
│   │   ├── auth/
│   │   │   └── Login.jsx       # Login page
│   │   │
│   │   ├── dashboard/
│   │   │   ├── Dashboard.jsx   # Main dashboard
│   │   │   ├── StatsCard.jsx   # Statistics card
│   │   │   └── ActivityChart.jsx # Activity chart
│   │   │
│   │   ├── users/
│   │   │   ├── UserList.jsx    # User list view
│   │   │   ├── UserCard.jsx    # User card component
│   │   │   ├── UserModal.jsx    # User edit modal
│   │   │   └── UserFilters.jsx # User search/filter
│   │   │
│   │   ├── plans/
│   │   │   ├── PlanManager.jsx # Plan management
│   │   │   └── PlanCard.jsx    # Plan card
│   │   │
│   │   └── credits/
│   │       ├── CreditManager.jsx # Credit adjustment
│   │       └── CreditHistory.jsx # Credit transaction history
│   │
│   ├── hooks/
│   │   ├── useAuth.js          # Authentication hook
│   │   ├── useUsers.js         # Users data hook
│   │   └── useStats.js         # Statistics hook
│   │
│   ├── services/
│   │   ├── firebaseService.js  # Firebase operations
│   │   └── authService.js      # Auth operations
│   │
│   └── utils/
│       ├── constants.js       # App constants
│       └── helpers.js          # Utility functions
│
├── package.json                # Dependencies
├── vite.config.js             # Vite configuration
├── tailwind.config.js        # Tailwind configuration
└── postcss.config.js         # PostCSS configuration
```

---

## Setup Instructions

### Prerequisites
- Node.js 18+ installed
- npm or yarn package manager
- Firebase project with Firestore enabled
- Admin email configured in Firebase Auth

### Installation Steps

1. **Create project directory:**
```bash
mkdir inshuverse-admin-dashboard
cd inshuverse-admin-dashboard
```

2. **Initialize project:**
```bash
npm init -y
```

3. **Install dependencies:**
```bash
npm install react react-dom react-router-dom firebase recharts date-fns lucide-react
npm install -D vite @vitejs/plugin-react tailwindcss autoprefixer postcss
```

4. **Initialize Tailwind CSS:**
```bash
npx tailwindcss init -p
```

5. **Create project structure** (see Project Structure above)

6. **Configure Firebase** (see Firebase Configuration section)

7. **Start development server:**
```bash
npm run dev
```

---

## Firebase Configuration

### Firebase Console Setup

1. **Enable Firestore:**
   - Go to Firebase Console → Project → Firestore Database
   - Click "Create Database"
   - Choose location (nearest to your users)
   - Start in production mode

2. **Enable Authentication:**
   - Go to Firebase Console → Project → Authentication
   - Click "Get Started"
   - Enable "Email/Password" sign-in method
   - Enable "Google" sign-in method (optional)

3. **Create Admin User:**
   - Go to Firebase Console → Project → Authentication
   - Click "Add user"
   - Create admin email (e.g., admin@inshuverse.ai)
   - Set password
   - Note: This user will have full access in the dashboard

4. **Configure Firestore Security Rules:**
   - Go to Firebase Console → Project → Firestore Database → Rules
   - Add admin-specific rules (see Security Rules section)

### Firebase Configuration File

Create `src/config/firebase.js`:

```javascript
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "inshuverse-ai.firebaseapp.com",
  projectId: "inshuverse-ai",
  storageBucket: "inshuverse-ai.firebasestorage.app",
  messagingSenderId: "239383899102",
  appId: "1:239383899102:web:3806b956be1caf72608b4f",
  measurementId: "G-YSWGRHXSHY"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
```

**Replace YOUR_API_KEY with your actual Firebase API key from Firebase Console.**

### Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Admin collection - only accessible by authenticated admin
    match /admins/{adminId} {
      allow read, write: if request.auth != null;
    }
    
    // Users collection - admin can read/write, users can read own data
    match /users/{userId} {
      allow read: if request.auth != null && 
                     (request.auth.uid == userId || 
                      get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.isAdmin == true);
      allow write: if request.auth != null && 
                      get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.isAdmin == true;
    }
    
    // Usage collection - admin can read/write
    match /usage/{usageId} {
      allow read, write: if request.auth != null && 
                          get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.isAdmin == true;
    }
  }
}
```

### Create Admin Document

Create an admin document in Firestore to grant admin access:

```javascript
// In Firebase Console → Firestore Database → admins collection
// Add document with ID = admin UID from Authentication

{
  "email": "admin@inshuverse.ai",
  "isAdmin": true,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

---

## Authentication System

### Auth Context (`src/context/AuthContext.jsx`)

```javascript
import React, { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [adminData, setAdminData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Check if user is admin
        const adminDoc = await getDoc(doc(db, 'admins', currentUser.uid));
        if (adminDoc.exists()) {
          setAdminData(adminDoc.data());
        } else {
          setAdminData(null);
        }
      } else {
        setAdminData(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const isAdmin = adminData?.isAdmin === true;

  return (
    <AuthContext.Provider value={{ user, adminData, isAdmin, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

### Login Component (`src/components/auth/Login.jsx`)

```javascript
import React, { useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, AlertCircle } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/dashboard');
    } catch (error) {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 to-indigo-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">InshuVerse AI</h1>
          <p className="text-gray-600">Admin Dashboard</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <span className="text-red-800 text-sm">{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="admin@inshuverse.ai"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-purple-600 text-white py-3 rounded-lg font-medium hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

---

## Complete Code Content

### Main Entry Point (`src/main.jsx`)

```javascript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
```

### App Component (`src/App.jsx`)

```javascript
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './components/auth/Login';
import Layout from './components/layout/Layout';
import Dashboard from './components/dashboard/Dashboard';
import UserList from './components/users/UserList';
import PlanManager from './components/plans/PlanManager';
import CreditManager from './components/credits/CreditManager';

function ProtectedRoute({ children }) {
  const { user, isAdmin, loading } = useAuth();
  
  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }
  
  if (!user || !isAdmin) {
    return <Navigate to="/login" />;
  }
  
  return children;
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/users" element={<UserList />} />
                  <Route path="/plans" element={<PlanManager />} />
                  <Route path="/credits" element={<CreditManager />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
```

### Layout Component (`src/components/layout/Layout.jsx`)

```javascript
import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { LogOut, Users, CreditCard, BarChart3, Settings } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const navItems = [
    { path: '/dashboard', icon: BarChart3, label: 'Dashboard' },
    { path: '/users', icon: Users, label: 'Users' },
    { path: '/plans', icon: CreditCard, label: 'Plans' },
    { path: '/credits', icon: Settings, label: 'Credits' },
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white shadow-lg">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-gray-900">InshuVerse AI</h1>
          <p className="text-sm text-gray-500">Admin Dashboard</p>
        </div>
        
        <nav className="p-4 space-y-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-purple-100 text-purple-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 w-64 p-4 border-t bg-white">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{user?.email}</p>
              <p className="text-xs text-gray-500">Administrator</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
```

### Dashboard Component (`src/components/dashboard/Dashboard.jsx`)

```javascript
import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Users, CreditCard, Activity, TrendingUp } from 'lucide-react';
import StatsCard from './StatsCard';
import ActivityChart from './ActivityChart';

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalCredits: 0,
    totalRevenue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      // Get total users
      const usersSnapshot = await getDocs(collection(db, 'users'));
      const totalUsers = usersSnapshot.size;

      // Calculate total credits
      let totalCredits = 0;
      usersSnapshot.forEach((doc) => {
        totalCredits += doc.data().credits || 0;
      });

      // Get active users (users with credits > 0)
      const activeQuery = query(
        collection(db, 'users'),
        where('credits', '>', 0)
      );
      const activeSnapshot = await getDocs(activeQuery);
      const activeUsers = activeSnapshot.size;

      setStats({
        totalUsers,
        activeUsers,
        totalCredits,
        totalRevenue: totalCredits * 0.01, // Assuming $0.01 per credit
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8">Loading statistics...</div>;
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Users"
          value={stats.totalUsers}
          icon={Users}
          color="blue"
        />
        <StatsCard
          title="Active Users"
          value={stats.activeUsers}
          icon={Activity}
          color="green"
        />
        <StatsCard
          title="Total Credits"
          value={stats.totalCredits}
          icon={CreditCard}
          color="purple"
        />
        <StatsCard
          title="Estimated Revenue"
          value={`$${stats.totalRevenue.toFixed(2)}`}
          icon={TrendingUp}
          color="orange"
        />
      </div>

      <ActivityChart />
    </div>
  );
}
```

### Stats Card Component (`src/components/dashboard/StatsCard.jsx`)

```javascript
import React from 'react';

const colorClasses = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
};

export default function StatsCard({ title, value, icon: Icon, color = 'blue' }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-lg ${colorClasses[color]}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
      </div>
      <h3 className="text-gray-500 text-sm font-medium mb-1">{title}</h3>
      <p className="text-3xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
```

### Activity Chart Component (`src/components/dashboard/ActivityChart.jsx`)

```javascript
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const data = [
  { name: 'Mon', users: 400, credits: 2400 },
  { name: 'Tue', users: 300, credits: 1398 },
  { name: 'Wed', users: 200, credits: 9800 },
  { name: 'Thu', users: 278, credits: 3908 },
  { name: 'Fri', users: 189, credits: 4800 },
  { name: 'Sat', users: 239, credits: 3800 },
  { name: 'Sun', users: 349, credits: 4300 },
];

export default function ActivityChart() {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Weekly Activity</h2>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Line type="monotone" dataKey="users" stroke="#8884d8" strokeWidth={2} />
          <Line type="monotone" dataKey="credits" stroke="#82ca9d" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### User List Component (`src/components/users/UserList.jsx`)

```javascript
import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Search, MoreVertical, Edit, Trash2 } from 'lucide-react';
import UserModal from './UserModal';

export default function UserList() {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const filtered = users.filter(
        (user) =>
          user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          user.plan?.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredUsers(filtered);
    } else {
      setFilteredUsers(users);
    }
  }, [searchTerm, users]);

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'), orderBy('createdAt', 'desc'));
      const snapshot = await getDocs(q);
      const usersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setUsers(usersData);
      setFilteredUsers(usersData);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEditUser = (user) => {
    setSelectedUser(user);
    setIsModalOpen(true);
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user?')) return;
    
    try {
      await updateDoc(doc(db, 'users', userId), {
        deleted: true,
        deletedAt: new Date().toISOString(),
      });
      fetchUsers();
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  };

  if (loading) {
    return <div className="p-8">Loading users...</div>;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Users</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Email
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Plan
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Credits
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Created
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">{user.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="px-2 py-1 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                    {user.plan || 'free'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{user.credits || 0}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-500">
                    {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEditUser(user)}
                      className="p-2 text-gray-400 hover:text-purple-600 transition-colors"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="p-2 text-gray-400 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <UserModal
          user={selectedUser}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedUser(null);
          }}
          onSave={() => {
            fetchUsers();
            setIsModalOpen(false);
            setSelectedUser(null);
          }}
        />
      )}
    </div>
  );
}
```

### User Modal Component (`src/components/users/UserModal.jsx`)

```javascript
import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { X } from 'lucide-react';

export default function UserModal({ user, onClose, onSave }) {
  const [plan, setPlan] = useState(user.plan || 'free');
  const [credits, setCredits] = useState(user.credits || 0);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await updateDoc(doc(db, 'users', user.id), {
        plan,
        credits: parseInt(credits),
        updatedAt: new Date().toISOString(),
      });
      onSave();
    } catch (error) {
      console.error('Error updating user:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Edit User</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <input
              type="email"
              value={user.email}
              disabled
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Plan
            </label>
            <select
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            >
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="ultimate">Ultimate</option>
              <option value="magic">Magic</option>
              <option value="lifetime">Lifetime</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Credits
            </label>
            <input
              type="number"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Plan Manager Component (`src/components/plans/PlanManager.jsx`)

```javascript
import React from 'react';
import { CreditCard, Users, TrendingUp } from 'lucide-react';

const plans = [
  {
    id: 'free',
    name: 'Free',
    credits: 7,
    price: 0,
    features: ['7 complimentary credits', 'System shared keys', 'Basic features'],
    color: 'gray',
  },
  {
    id: 'pro',
    name: 'Pro',
    credits: 600,
    price: 9.99,
    features: ['600 credits/month', 'Premium keys', 'Priority support'],
    color: 'blue',
  },
  {
    id: 'ultimate',
    name: 'Ultimate',
    credits: 1500,
    price: 19.99,
    features: ['1500 credits/month', 'Premium keys', 'Priority support', 'Advanced features'],
    color: 'purple',
  },
  {
    id: 'magic',
    name: 'Magic',
    credits: 4000,
    price: 39.99,
    features: ['4000 credits/month', 'Premium keys', 'Priority support', 'All features'],
    color: 'orange',
  },
  {
    id: 'lifetime',
    name: 'Lifetime',
    credits: 'Unlimited',
    price: 199.99,
    features: ['Unlimited credits', 'Bring your own keys', 'Lifetime support', 'All features'],
    color: 'green',
  },
];

const colorClasses = {
  gray: 'bg-gray-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  green: 'bg-green-500',
};

export default function PlanManager() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Plan Management</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className="bg-white rounded-xl shadow-sm p-6 border-2 border-transparent hover:border-purple-500 transition-colors"
          >
            <div className={`w-12 h-12 rounded-lg ${colorClasses[plan.color]} flex items-center justify-center mb-4`}>
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            
            <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.name}</h3>
            
            <div className="mb-4">
              <span className="text-3xl font-bold text-gray-900">
                {plan.credits === 'Unlimited' ? '∞' : plan.credits}
              </span>
              <span className="text-gray-500 text-sm"> credits</span>
            </div>

            <div className="mb-4">
              <span className="text-2xl font-bold text-gray-900">
                ${plan.price}
              </span>
              <span className="text-gray-500 text-sm">
                {plan.price === 0 ? '/one-time' : '/month'}
              </span>
            </div>

            <ul className="space-y-2 mb-6">
              {plan.features.map((feature, index) => (
                <li key={index} className="text-sm text-gray-600 flex items-start">
                  <span className="text-green-500 mr-2">✓</span>
                  {feature}
                </li>
              ))}
            </ul>

            <button className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">
              Edit Plan
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Credit Manager Component (`src/components/credits/CreditManager.jsx`)

```javascript
import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where, orderBy, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { Search, Plus, Minus } from 'lucide-react';

export default function CreditManager() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [creditAmount, setCreditAmount] = useState('');
  const [operation, setOperation] = useState('add');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'), orderBy('email'));
      const snapshot = await getDocs(q);
      const usersData = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setUsers(usersData);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleCreditAdjustment = async () => {
    if (!selectedUser || !creditAmount) return;

    setLoading(true);
    try {
      const userRef = doc(db, 'users', selectedUser.id);
      const currentCredits = selectedUser.credits || 0;
      const adjustment = parseInt(creditAmount);
      
      const newCredits = operation === 'add' 
        ? currentCredits + adjustment 
        : currentCredits - adjustment;

      await updateDoc(userRef, {
        credits: Math.max(0, newCredits),
        updatedAt: new Date().toISOString(),
      });

      // Log transaction
      await addDoc(collection(db, 'creditTransactions'), {
        userId: selectedUser.id,
        userEmail: selectedUser.email,
        operation,
        amount: adjustment,
        previousCredits: currentCredits,
        newCredits: Math.max(0, newCredits),
        admin: 'admin@inshuverse.ai',
        timestamp: new Date().toISOString(),
      });

      fetchUsers();
      setSelectedUser(null);
      setCreditAmount('');
    } catch (error) {
      console.error('Error adjusting credits:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Credit Management</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">Adjust Credits</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select User
              </label>
              <select
                value={selectedUser?.id || ''}
                onChange={(e) => {
                  const user = users.find((u) => u.id === e.target.value);
                  setSelectedUser(user || null);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="">Select a user...</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.email} ({user.credits || 0} credits)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Operation
              </label>
              <div className="flex gap-4">
                <button
                  onClick={() => setOperation('add')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    operation === 'add'
                      ? 'bg-green-100 text-green-700 border-2 border-green-500'
                      : 'bg-gray-100 text-gray-700 border-2 border-transparent'
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  Add Credits
                </button>
                <button
                  onClick={() => setOperation('remove')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                    operation === 'remove'
                      ? 'bg-red-100 text-red-700 border-2 border-red-500'
                      : 'bg-gray-100 text-gray-700 border-2 border-transparent'
                  }`}
                >
                  <Minus className="w-4 h-4" />
                  Remove Credits
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Amount
              </label>
              <input
                type="number"
                value={creditAmount}
                onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="Enter amount..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {selectedUser && (
              <div className="bg-gray-50 rounded-lg p-4">
                <p className="text-sm text-gray-600">
                  Current credits: <span className="font-bold">{selectedUser.credits || 0}</span>
                </p>
                <p className="text-sm text-gray-600">
                  New credits: <span className="font-bold">
                    {operation === 'add'
                      ? (selectedUser.credits || 0) + parseInt(creditAmount || 0)
                      : Math.max(0, (selectedUser.credits || 0) - parseInt(creditAmount || 0))
                    }
                  </span>
                </p>
              </div>
            )}

            <button
              onClick={handleCreditAdjustment}
              disabled={!selectedUser || !creditAmount || loading}
              className="w-full py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Processing...' : 'Adjust Credits'}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-6">All Users</h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{user.email}</p>
                  <p className="text-xs text-gray-500">{user.plan || 'free'} plan</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900">{user.credits || 0}</p>
                  <p className="text-xs text-gray-500">credits</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Global Styles (`src/index.css`)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

code {
  font-family: source-code-pro, Menlo, Monaco, Consolas, 'Courier New',
    monospace;
}
```

### HTML Entry Point (`public/index.html`)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>InshuVerse AI - Admin Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### Tailwind Configuration (`tailwind.config.js`)

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### PostCSS Configuration (`postcss.config.js`)

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

---

## Features Documentation

### 1. Dashboard Overview

**Features:**
- Real-time statistics (total users, active users, total credits, estimated revenue)
- Weekly activity chart showing user and credit trends
- Quick navigation to other sections

**Data Sources:**
- Total Users: Count of all documents in `users` collection
- Active Users: Count of users with credits > 0
- Total Credits: Sum of all user credits
- Estimated Revenue: Total credits × $0.01 (adjustable rate)

### 2. User Management

**Features:**
- View all users with email, plan, credits, and creation date
- Search users by email or plan
- Edit user plan and credits
- Soft delete users (marks as deleted, doesn't remove data)
- Real-time data synchronization

**User Data Structure:**
```javascript
{
  id: "user-uid",
  email: "user@example.com",
  plan: "free" | "pro" | "ultimate" | "magic" | "lifetime",
  credits: 7,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  deleted: false,
  deletedAt: null
}
```

### 3. Plan Management

**Features:**
- View all available plans with details
- Plan comparison (credits, price, features)
- Edit plan configurations
- Visual plan cards with color coding

**Plan Structure:**
```javascript
{
  id: "plan-id",
  name: "Plan Name",
  credits: 7 | 600 | 1500 | 4000 | "Unlimited",
  price: 0 | 9.99 | 19.99 | 39.99 | 199.99,
  features: ["Feature 1", "Feature 2", ...],
  color: "gray" | "blue" | "purple" | "orange" | "green"
}
```

### 4. Credit Management

**Features:**
- Add or remove credits from any user
- Real-time credit calculation preview
- Transaction logging for audit trail
- User selection with current credit display
- Bulk operations (future enhancement)

**Transaction Structure:**
```javascript
{
  userId: "user-uid",
  userEmail: "user@example.com",
  operation: "add" | "remove",
  amount: 10,
  previousCredits: 7,
  newCredits: 17,
  admin: "admin@inshuverse.ai",
  timestamp: "2024-01-01T00:00:00Z"
}
```

---

## Deployment Guide

### Deployment Options

**Option 1: Vercel (Recommended)**
1. Push code to GitHub
2. Import project in Vercel
3. Configure environment variables
4. Deploy

**Option 2: Netlify**
1. Build project: `npm run build`
2. Deploy `dist` folder to Netlify
3. Configure environment variables

**Option 3: Firebase Hosting**
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Initialize: `firebase init hosting`
3. Build: `npm run build`
4. Deploy: `firebase deploy`

### Environment Variables

Create `.env` file in project root:

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

Update `src/config/firebase.js` to use environment variables:

```javascript
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
```

### Build Commands

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

### Security Considerations

1. **Firebase Security Rules:**
   - Only allow authenticated admin access
   - Validate all write operations
   - Use Firestore rules for data validation

2. **Authentication:**
   - Use strong passwords for admin accounts
   - Enable 2FA for admin accounts (Firebase Auth supports this)
   - Regularly rotate admin credentials

3. **Environment Variables:**
   - Never commit `.env` files
   - Use different configs for dev/prod
   - Rotate API keys periodically

4. **Audit Logging:**
   - Log all admin actions
   - Store transaction history
   - Implement admin activity monitoring

---

## Troubleshooting

### Common Issues

**1. Firebase Connection Error**
- Verify Firebase configuration in `firebase.js`
- Check that Firestore is enabled in Firebase Console
- Ensure API key is correct

**2. Authentication Not Working**
- Verify admin user exists in Firebase Auth
- Check that admin document exists in `admins` collection
- Ensure security rules allow admin access

**3. Data Not Loading**
- Check browser console for errors
- Verify Firestore security rules
- Ensure user has proper permissions

**4. Build Errors**
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check Node.js version (requires 18+)
- Verify all dependencies are installed

---

## Future Enhancements

### Planned Features

1. **Advanced Analytics**
   - User retention metrics
   - Feature usage breakdown
   - Revenue forecasting
   - Export reports (CSV, PDF)

2. **Bulk Operations**
   - Bulk credit adjustment
   - Bulk plan changes
   - User import/export
   - CSV upload for user data

3. **Payment Integration**
   - Stripe dashboard integration
   - Subscription management
   - Invoice generation
   - Payment history

4. **Notification System**
   - Email notifications for low credits
   - In-app notifications
   - Admin alerts
   - System health monitoring

5. **Role-Based Access**
   - Multiple admin roles (super admin, support, viewer)
   - Granular permissions
   - Audit trail per admin
   - Admin activity logs

---

## Support

For issues or questions:
- Email: avtechsolutions312@gmail.com
- GitHub: https://github.com/A-V-TechSolutions/InshuVerse-AI
- Firebase Console: https://console.firebase.google.com

---

## License

MIT License - Copyright © 2026 A&V Techsolutions
