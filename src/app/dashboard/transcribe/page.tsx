'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { VideoUpload } from '@/components/dashboard/VideoUpload';
import { AudioUpload } from '@/components/dashboard/AudioUpload';
import { DocumentUpload } from '@/components/dashboard/DocumentUpload';
import { YouTubeUpload } from '@/components/dashboard/YouTubeUpload';
import { LinkUpload } from '@/components/dashboard/LinkUpload';
import { TextUpload } from '@/components/dashboard/TextUpload';

export default function TranscribePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Upload</h1>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <Tabs defaultValue="video" className="w-full">
          <div className="border-b border-gray-100 px-6">
            <TabsList className="flex gap-8 bg-transparent p-0 h-12 w-auto justify-start shadow-none rounded-none border-none">
              {['video', 'audio', 'documents', 'youtube', 'links', 'text'].map((tab) => (
                <TabsTrigger 
                  key={tab}
                  value={tab}
                  className="
                    relative
                    bg-transparent 
                    !bg-transparent
                    !shadow-none
                    !border-0
                    !border-b-2 
                    !border-transparent 
                    data-[state=active]:!border-black 
                    data-[state=active]:!text-black 
                    text-gray-500 
                    hover:text-gray-700 
                    transition-all
                    capitalize
                    text-sm
                    font-medium
                    px-1
                    h-full
                    rounded-none
                  "
                >
                  {tab}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="p-8">
            <TabsContent value="video" className="mt-0 focus-visible:outline-none">
              <VideoUpload />
            </TabsContent>

            <TabsContent value="audio" className="mt-0 focus-visible:outline-none">
              <AudioUpload />
            </TabsContent>

            <TabsContent value="documents" className="mt-0 focus-visible:outline-none">
              <DocumentUpload />
            </TabsContent>

            <TabsContent value="youtube" className="mt-0 focus-visible:outline-none">
              <YouTubeUpload />
            </TabsContent>

            <TabsContent value="links" className="mt-0 focus-visible:outline-none">
              <LinkUpload />
            </TabsContent>

            <TabsContent value="text" className="mt-0 focus-visible:outline-none">
              <TextUpload />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
