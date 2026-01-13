'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { FileText, Upload, Settings } from 'lucide-react';

const navigation = [
  { name: 'Content', href: '/dashboard/content', icon: FileText },
  { name: 'Upload', href: '/dashboard/transcribe', icon: Upload },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex w-64 flex-col bg-white border-r border-gray-100 h-full">
      {/* Header */}
      <div className="flex h-16 items-center px-6 border-b border-gray-50">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-black rounded-lg flex items-center justify-center text-white font-bold text-sm">
            EE
          </div>
          <span className="text-lg font-bold text-gray-900 tracking-tight">Elite Ecommerce</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
        {navigation.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-gray-50 text-gray-900 shadow-sm border border-gray-100'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
              )}
            >
              {item.icon && <item.icon className={cn("h-4 w-4", isActive ? "text-gray-900" : "text-gray-400")} />}
              {item.name}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
