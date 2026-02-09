import YoutubePlayer from '@/components/YoutubePlayer';

export default function TestPage() {
  return (
    <main className="min-h-screen bg-white p-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-black text-3xl font-bold mb-8">
          시스템 기능 테스트
        </h1>
        
        {/* 플레이어 컨테이너의 크기를 확실히 지정 */}
        <div className="w-full border-4 border-dashed border-gray-200 rounded-2xl p-2">
          <YoutubePlayer 
            videoId="7C2z4GmrS9E" 
            assignmentId="test-123" 
          />
        </div>

        <div className="mt-10 p-6 bg-blue-50 rounded-xl">
          <h2 className="text-blue-800 font-bold mb-2 text-lg">재생이 여전히 안 된다면?</h2>
          <ol className="text-blue-700 list-decimal ml-5 space-y-1">
            <li>터미널에서 <strong>npm install react-player</strong>를 다시 한 번 입력해 보세요.</li>
            <li>브라우저 주소창에 <strong>localhost:3000</strong> 대신 <strong>127.0.0.1:3000</strong>으로 접속해 보세요.</li>
            <li>유튜브 영상 자체가 외부 재생이 막힌 영상인지 확인해 보세요. (dQw4w9WgXcQ는 보통 잘 됩니다.)</li>
          </ol>
        </div>
      </div>
    </main>
  );
}