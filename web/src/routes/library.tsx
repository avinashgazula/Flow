import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library')({
  component: () => (
    <div className="page">
      <h1 className="page-title">Library</h1>
    </div>
  ),
})
