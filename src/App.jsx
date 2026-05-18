import React, { useState, useEffect, useRef } from 'react';
import { Activity, Usb, PlayCircle, BarChart3, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const CustomDot = (props) => {
  const { cx, cy, payload } = props;
  if (payload.isCFF) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={6} fill="#ef4444" stroke="#fff" strokeWidth={2} />
        <text x={cx} y={cy - 12} textAnchor="middle" fill="#ef4444" fontSize="12" fontWeight="bold">
          {payload.cffLabel}
        </text>
      </g>
    );
  }
  return null;
};

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [liveFreq, setLiveFreq] = useState(0);
  const [chartData, setChartData] = useState([]);
  const [iterations, setIterations] = useState([null, null, null]);
  const [average, setAverage] = useState(null);
  
  // For the Web Serial connection
  const portRef = useRef(null);
  const readerRef = useRef(null);
  
  // For mock data
  const [isMocking, setIsMocking] = useState(false);
  const mockIntervalRef = useRef(null);

  // Auto-scroll logic or keeping only last N points for performance
  const MAX_DATA_POINTS = 50;

  const appendChartData = (freq) => {
    setChartData(prev => {
      const now = new Date();
      const timeStr = `${now.getSeconds()}.${now.getMilliseconds()}`.substring(0, 4);
      const newData = [...prev, { time: timeStr, freq: parseFloat(freq) }];
      if (newData.length > MAX_DATA_POINTS) {
        return newData.slice(newData.length - MAX_DATA_POINTS);
      }
      return newData;
    });
  };

  const handleSerialData = (line) => {
    line = line.trim();
    if (!line) return;

    // 1. Check for Average
    const avgMatch = line.match(/^(?:AVG:|Average Frequency:\s*)([\d.]+)/i);
    if (avgMatch) {
      const val = parseFloat(avgMatch[1]);
      if (!isNaN(val)) setAverage(val);
      return;
    }

    // 2. Check for Iteration/Reading format
    const iterMatchLegacy = line.match(/^ITER:(\d+),RESULT:([\d.]+)/i);
    const iterMatchReading = line.match(/^Reading\s+(\d+):\s*([\d.]+)/i);
    
    if (iterMatchLegacy || iterMatchReading) {
      const iterNum = parseInt(iterMatchLegacy ? iterMatchLegacy[1] : iterMatchReading[1], 10);
      const result = parseFloat(iterMatchLegacy ? iterMatchLegacy[2] : iterMatchReading[2]);
      
      if (!isNaN(iterNum) && !isNaN(result)) {
        setIterations(prev => {
          const newIters = [...prev];
          if (iterNum >= 1 && iterNum <= 3) {
            newIters[iterNum - 1] = result;
          }
          return newIters;
        });

        // Add this to chart data as a CFF point
        setChartData(prev => {
          const now = new Date();
          const timeStr = `${now.getSeconds()}.${now.getMilliseconds()}`.substring(0, 4);
          const newData = [...prev, { time: timeStr, freq: result, isCFF: true, cffLabel: `Iter ${iterNum}` }];
          if (newData.length > MAX_DATA_POINTS) {
            return newData.slice(newData.length - MAX_DATA_POINTS);
          }
          return newData;
        });
        
        // Also update live freq
        setLiveFreq(result);
      }
      return;
    }

    // 3. Status messages
    if (/^Test Aborted/i.test(line) || /^Starting new test/i.test(line) || /^OLED failed/i.test(line)) {
      console.log('Device message:', line);
      return;
    }

    // 4. Check for live frequency data
    // Matches "FREQ: 45.2", "45.2", "45.2 Hz", "Frequency: 45.2", etc.
    const freqMatch = line.match(/(?:^|FREQ:|Frequency:|Freq:|Live:|Current:|\s)([\d.]+)(?:\s*Hz)?$/i);
    if (freqMatch) {
      const val = parseFloat(freqMatch[1]);
      if (!isNaN(val)) {
        setLiveFreq(val);
        appendChartData(val);
      }
      return;
    }

    console.log('Unrecognized serial line:', line);
  };

  // ----- Web Serial API Integration -----
  const connectDevice = async () => {
    if (!('serial' in navigator)) {
      alert("Web Serial API is not supported in this browser. Please use Chrome or Edge.");
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 9600 }); // Default Arduino baud rate
      portRef.current = port;
      setIsConnected(true);

      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      readerRef.current = reader;

      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          reader.releaseLock();
          break;
        }
        
        buffer += value;
        const lines = buffer.split('\n');
        
        // Process all complete lines
        for (let i = 0; i < lines.length - 1; i++) {
          handleSerialData(lines[i]);
        }
        
        // Keep the incomplete line in the buffer
        buffer = lines[lines.length - 1];
      }
    } catch (error) {
      console.error("Error connecting to device:", error);
      // Don't alert if the user just cancelled the port selection
      if (error.name !== 'NotFoundError') {
        alert("Failed to connect: " + error.message);
      }
    }
  };

  const disconnectDevice = async () => {
    if (readerRef.current) {
      await readerRef.current.cancel();
      readerRef.current = null;
    }
    if (portRef.current) {
      await portRef.current.close();
      portRef.current = null;
    }
    setIsConnected(false);
  };

  // ----- Mock Data Generator -----
  const toggleMockData = () => {
    if (isMocking) {
      clearInterval(mockIntervalRef.current);
      setIsMocking(false);
      setLiveFreq(0);
    } else {
      setIsMocking(true);
      // Reset state
      setIterations([null, null, null]);
      setAverage(null);
      setChartData([]);
      
      let step = 0;
      let currentFreq = 30.0;
      
      mockIntervalRef.current = setInterval(() => {
        step++;
        
        // Simulate frequency ramping up and down
        currentFreq += (Math.random() - 0.4) * 0.5;
        if (currentFreq < 30) currentFreq = 30;
        if (currentFreq > 55) currentFreq = 55;
        
        handleSerialData(`FREQ:${currentFreq.toFixed(1)}`);
        
        // Simulate completing iterations
        if (step === 30) {
          handleSerialData(`ITER:1,RESULT:${currentFreq.toFixed(1)}`);
        } else if (step === 60) {
          handleSerialData(`ITER:2,RESULT:${currentFreq.toFixed(1)}`);
        } else if (step === 90) {
          handleSerialData(`ITER:3,RESULT:${currentFreq.toFixed(1)}`);
          
          // Calculate avg
          setTimeout(() => {
            setAverage(42.8); // Dummy average
            handleSerialData(`AVG:42.8`);
          }, 1000);
          
          // Stop mocking
          clearInterval(mockIntervalRef.current);
          setIsMocking(false);
        }
      }, 100); // Send data every 100ms
    }
  };

  useEffect(() => {
    return () => {
      if (mockIntervalRef.current) clearInterval(mockIntervalRef.current);
    };
  }, []);

  return (
    <div className="container">
      {/* Header Panel */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1>CFF Analyzer</h1>
          <p className="text-muted">Critical Flicker Fusion Device Dashboard</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className={`status-badge ${isConnected ? 'status-connected' : 'status-disconnected'}`}>
            <span className="status-dot"></span>
            {isConnected ? 'Device Connected' : 'Disconnected'}
          </div>
          
          {isConnected ? (
            <button className="btn btn-outline" onClick={disconnectDevice}>Disconnect</button>
          ) : (
            <button className="btn btn-primary" onClick={connectDevice}>
              <Usb size={18} />
              Connect Device
            </button>
          )}

          {!isConnected && (
            <button className="btn btn-outline" onClick={toggleMockData} title="Test UI with fake data">
              {isMocking ? 'Stop Test' : 'Run Mock Test'}
            </button>
          )}
        </div>
      </header>

      {/* Main Content Grid */}
      <div className="grid" style={{ gridTemplateColumns: '1fr 300px' }}>
        
        {/* Left Column: Graph & Live Data */}
        <div className="grid gap-6">
          <div className="glass-card flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2" style={{ margin: 0 }}>
                <Activity size={24} color="var(--primary)" />
                Live Frequency
              </h2>
              <p className="text-muted">Real-time data from Arduino</p>
            </div>
            <div className="value-display">
              <span className="value-large">{liveFreq.toFixed(1)}</span>
              <span className="value-unit">Hz</span>
            </div>
          </div>

          <div className="glass-card" style={{ height: '400px' }}>
            <h2 className="flex items-center gap-2">
              <BarChart3 size={20} color="var(--accent)" />
              Frequency Graph
            </h2>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="time" stroke="var(--text-secondary)" tick={{fontSize: 12}} />
                <YAxis stroke="var(--text-secondary)" domain={['dataMin - 5', 'dataMax + 5']} tick={{fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--bg-color)', border: '1px solid var(--card-border)', borderRadius: '8px' }}
                  itemStyle={{ color: 'var(--primary)' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="freq" 
                  stroke="var(--primary)" 
                  strokeWidth={3} 
                  dot={<CustomDot />}
                  activeDot={{ r: 6, fill: 'var(--accent)' }}
                  animationDuration={300}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Results */}
        <div className="grid gap-4" style={{ alignContent: 'start' }}>
          <div className="glass-card">
            <h2>Results</h2>
            
            <div className="grid gap-4 mt-4">
              {[1, 2, 3].map((num, idx) => (
                <div key={num} className="flex items-center justify-between p-3" style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                  <span className="text-muted font-medium">Iteration {num}</span>
                  <div className="value-display">
                    {iterations[idx] !== null ? (
                      <>
                        <span className="value-medium" style={{ fontSize: '1.25rem' }}>{iterations[idx].toFixed(1)}</span>
                        <span className="value-unit">Hz</span>
                      </>
                    ) : (
                      <span className="text-muted">--</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--card-border)' }}>
              <span className="text-muted font-medium block mb-2 text-center uppercase tracking-wider text-xs">Final Average</span>
              <div className="value-display text-center">
                {average !== null ? (
                  <>
                    <span className="value-large text-transparent bg-clip-text" style={{ backgroundImage: 'linear-gradient(to right, #10b981, #34d399)' }}>
                      {average.toFixed(1)}
                    </span>
                    <span className="value-unit" style={{ color: '#10b981' }}>Hz</span>
                  </>
                ) : (
                  <span className="text-muted">--</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="glass-card text-sm text-muted flex gap-3">
            <Info size={20} className="shrink-0" color="var(--accent)" />
            <div>
              <p className="mb-2"><strong>Arduino Setup:</strong> Ensure your Arduino prints exactly:</p>
              <ul style={{ paddingLeft: '1.2rem', fontFamily: 'monospace' }}>
                <li>Reading 1: 45.2 Hz</li>
                <li>Reading 2: 46.1 Hz</li>
                <li>Average Frequency: 44.8 Hz</li>
              </ul>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}

export default App;
