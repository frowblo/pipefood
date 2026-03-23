import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import PlannerPage from './pages/PlannerPage'
import RecipesPage from './pages/RecipesPage'
import ShoppingPage from './pages/ShoppingPage'
import PantryPage from './pages/PantryPage'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,  // 30s before refetch
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<App />}>
            <Route index element={<PlannerPage />} />
            <Route path="recipes" element={<RecipesPage />} />
            <Route path="shopping" element={<ShoppingPage />} />
            <Route path="pantry" element={<PantryPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
)
