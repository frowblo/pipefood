import { NavLink, Outlet } from 'react-router-dom'
import './App.css'

const NAV = [
  { to: '/',          label: 'Planner',   icon: <GridIcon /> },
  { to: '/this-week', label: 'This week', icon: <ChefIcon /> },
  { to: '/recipes',   label: 'Recipes',   icon: <BookIcon /> },
  { to: '/shopping',  label: 'Shopping',  icon: <ListIcon /> },
  { to: '/pantry',    label: 'Pantry',    icon: <BoxIcon /> },
  { to: '/settings',  label: 'Settings',  icon: <SettingsIcon /> },
]

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-pipe">pipe</span>
          <span className="logo-food">food</span>
        </div>
        <nav className="nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-item">
              {n.icon}
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-area">
        <Outlet />
      </main>
    </div>
  )
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <rect x="1" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8.5" y="1" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}

function ChefIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M7.5 1.5a3 3 0 00-3 3v.5H3a1 1 0 00-1 1v6a1 1 0 001 1h9a1 1 0 001-1V6a1 1 0 00-1-1h-1.5V4.5a3 3 0 00-3-3z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.5 9h4M7.5 7v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M2 2.5A1.5 1.5 0 013.5 1h8A1.5 1.5 0 0113 2.5v10a1.5 1.5 0 01-1.5 1.5h-8A1.5 1.5 0 012 12.5v-10z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5 5h5M5 7.5h5M5 10h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M2.5 4h10M2.5 7.5h10M2.5 11h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <circle cx="7.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7.5 1v1.5M7.5 12.5V14M1 7.5h1.5M12.5 7.5H14M2.6 2.6l1.1 1.1M11.3 11.3l1.1 1.1M2.6 12.4l1.1-1.1M11.3 3.7l1.1-1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M1.5 4.5l6-3 6 3v6l-6 3-6-3v-6z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7.5 1.5v13M1.5 4.5l6 3 6-3" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}
