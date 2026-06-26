import { useState } from 'react';
import { Lock, Percent } from 'lucide-react';
import { useRateAuth } from '../contexts/RateAuthContext';

interface RateLoginProps {
  onClose?: () => void;
}

export default function RateLogin({ onClose }: RateLoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useRateAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const success = await login(password);

    if (!success) {
      setError('كلمة المرور غير صحيحة');
      setPassword('');
    }

    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-dark p-8 rounded-2xl border-2 border-primary/50 max-w-md w-full shadow-2xl">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-4">
            <div className="bg-emerald-500/20 p-4 rounded-full border-2 border-emerald-500">
              <Percent className="w-12 h-12 text-emerald-400" />
            </div>
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">نظام النسب</h2>
          <p className="text-muted">RATE SYSTEM</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-muted mb-2 text-right">كلمة المرور</label>
            <div className="relative">
              <Lock className="absolute right-3 top-1/2 transform -translate-y-1/2 text-emerald-400 w-5 h-5" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-dark border-2 border-primary/50 rounded-lg px-12 py-3 text-white text-right focus:outline-none focus:border-primary transition-colors"
                placeholder="أدخل كلمة المرور"
                dir="rtl"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded-lg text-right">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg transition-colors"
              >
                إلغاء
              </button>
            )}
            <button
              type="submit"
              disabled={loading || !password}
              className="flex-1 bg-primary hover:bg-primary/80 disabled:bg-purple-800 disabled:cursor-not-allowed text-white py-3 rounded-lg transition-colors font-bold"
            >
              {loading ? 'جاري التحقق...' : 'دخول'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
