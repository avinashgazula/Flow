import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: () => (
    <div className="page">
      <h1 className="page-title">Settings</h1>
    </div>
  ),
})
