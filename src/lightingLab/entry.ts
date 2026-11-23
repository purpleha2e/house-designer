if (new URLSearchParams(location.search).has('house')) await import('./houseMain')
else await import('./main')
export {}
