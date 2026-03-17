import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function NewProjectPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Create project in Supabase
    console.log('Creating project:', { name, description });
    navigate('/projects');
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-10">
        <p className="text-[11px] tracking-[0.25em] uppercase text-accent mb-2 font-mono">
          New Project
        </p>
        <h1 className="font-sans text-3xl font-extrabold text-heading tracking-tight">
          Create a Project
        </h1>
        <p className="text-sm text-muted mt-1">
          Give your project a name and start tracking everything in one place.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
            Project Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Odyssey v1"
            className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>

        <div>
          <label className="block text-[10px] tracking-[0.2em] uppercase text-muted mb-2">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What is this project about?"
            className="w-full px-4 py-3 bg-surface border border-border text-heading text-sm font-mono placeholder:text-muted/50 focus:outline-none focus:border-accent/50 transition-colors resize-none"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            className="px-6 py-2.5 bg-accent/10 border border-accent/30 text-accent text-xs font-sans font-semibold tracking-wider uppercase hover:bg-accent/20 transition-colors rounded-md"
          >
            Create Project
          </button>
          <button
            type="button"
            onClick={() => navigate('/projects')}
            className="px-6 py-2.5 border border-border text-muted text-xs font-sans font-semibold tracking-wider uppercase hover:text-heading hover:bg-surface2 transition-colors rounded-md"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
