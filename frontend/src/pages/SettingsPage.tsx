import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

const woolworthsApi = {
  status: () => api.get<{ linked: boolean; expires?: string }>('/woolworths/status').then(r => r.data),
  unlink: () => api.delete('/woolworths/link'),
}

export default function SettingsPage() {
  const qc = useQueryClient()

  const { data: status, isLoading } = useQuery({
    queryKey: ['woolworths-status'],
    queryFn: woolworthsApi.status,
  })

  const unlink = useMutation({
    mutationFn: woolworthsApi.unlink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['woolworths-status'] }),
  })

  // The bookmarklet script — posts document.cookie to PipeFood
  // window.location.origin gets the current domain so it works on any install
  const bookmarkletCode = `javascript:(function(){
var p='${window.location.origin}';
fetch(p+'/api/woolworths/link',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({cookies:document.cookie})
}).then(function(r){return r.json()}).then(function(){
  alert('Woolworths linked to PipeFood!')
}).catch(function(){
  alert('Link failed. Make sure you are on woolworths.com.au and logged in.')
})
})()`.replace(/\n/g, '').replace(/\s+/g, ' ')

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="page-body" style={{ maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Woolworths account */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8, background: '#007837',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="white" strokeWidth="1.8"/>
                <path d="M3 6h18M16 10a4 4 0 01-8 0" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 14 }}>Woolworths account</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                {isLoading ? 'Checking...' : status?.linked ? (
                  <>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', background: '#007837',
                      display: 'inline-block', flexShrink: 0,
                    }} />
                    Linked {status.expires ? `· linked on ${status.expires}` : ''}
                  </>
                ) : (
                  <>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', background: '#ccc',
                      display: 'inline-block', flexShrink: 0,
                    }} />
                    Not linked
                  </>
                )}
              </div>
            </div>
            {status?.linked && (
              <button className="btn btn-ghost"
                style={{ fontSize: 12, color: 'var(--color-red)' }}
                disabled={unlink.isPending}
                onClick={() => unlink.mutate()}>
                Unlink
              </button>
            )}
          </div>

          {!status?.linked && (
            <>
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 10 }}>
                  Link your account in two steps:
                </div>

                {/* Step 1 — bookmarklet */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', background: 'var(--color-brand-light)',
                    color: 'var(--color-brand-dark)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0, marginTop: 1,
                  }}>1</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>
                      Drag this button to your bookmarks bar:
                    </div>
                    <a
                      href={bookmarkletCode}
                      onClick={e => e.preventDefault()}
                      draggable
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '8px 16px', borderRadius: 'var(--radius-md)',
                        background: '#007837', color: '#fff',
                        fontSize: 13, fontWeight: 500,
                        cursor: 'grab', textDecoration: 'none',
                        border: '2px dashed rgba(255,255,255,0.4)',
                        userSelect: 'none',
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" stroke="white" strokeWidth="2"/>
                        <path d="M3 6h18M16 10a4 4 0 01-8 0" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      Link PipeFood to Woolworths
                    </a>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
                      Drag the button above to your browser's bookmarks bar
                    </div>
                  </div>
                </div>

                {/* Step 2 — use it */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', background: 'var(--color-brand-light)',
                    color: 'var(--color-brand-dark)', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', fontSize: 11, fontWeight: 500, flexShrink: 0, marginTop: 1,
                  }}>2</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13 }}>
                      Go to{' '}
                      <a href="https://www.woolworths.com.au" target="_blank" rel="noreferrer"
                        style={{ color: '#007837' }}>
                        woolworths.com.au
                      </a>
                      , log in, then click the <strong>Link PipeFood to Woolworths</strong> bookmark.
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                      You'll see a confirmation message when it's done. Come back here to verify.
                    </div>
                  </div>
                </div>
              </div>

              <button className="btn" style={{ alignSelf: 'flex-start', fontSize: 12 }}
                onClick={() => qc.invalidateQueries({ queryKey: ['woolworths-status'] })}>
                Check link status
              </button>
            </>
          )}

          {status?.linked && (
            <div style={{
              borderTop: '1px solid var(--color-border)', paddingTop: 12,
              fontSize: 12, color: 'var(--color-text-secondary)',
            }}>
              Your Woolworths session is used to search and match products on your shopping list.
              If matching stops working, unlink and re-link your account.
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
