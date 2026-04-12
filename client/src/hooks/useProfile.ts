import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  email?: string | null;
  thesis_page_snapshot?: unknown;
}

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setProfile(data);
        setLoading(false);
      });
  }, [user]);

  const updateProfile = async (updates: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'thesis_page_snapshot'>>) => {
    if (!user) throw new Error('Not authenticated');
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    if (data) setProfile(data);
    return data;
  };

  return { profile, loading, updateProfile };
}
