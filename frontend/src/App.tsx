import { NavLink, Outlet } from 'react-router-dom'
import './App.css'

const NAV = [
  { to: '/',          label: 'Planner',       icon: <GridIcon /> },
  { to: '/recipes',   label: 'Recipes',       icon: <BookIcon /> },
  { to: '/shopping',  label: 'Shopping list', icon: <ListIcon /> },
  { to: '/pantry',    label: 'Pantry',        icon: <BoxIcon /> },
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
              {n.label}
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

function BoxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
      <path d="M1.5 4.5l6-3 6 3v6l-6 3-6-3v-6z" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M7.5 1.5v13M1.5 4.5l6 3 6-3" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  )
}
