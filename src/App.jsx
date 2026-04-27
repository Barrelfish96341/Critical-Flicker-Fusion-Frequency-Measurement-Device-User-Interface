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

    if (line.startsWith('FREQ:')) {
      const val = parseFloat(line.substring(5));
      if (!isNaN(val)) {
        setLiveFreq(val);
        appendChartData(val);
      }
    } else if (line.startsWith('ITER:')) {
      // Expected format: ITER:1,RESULT:45.0
      try {
        const parts = line.split(',');
        const iterNum = parseInt(parts[0].split(':')[1]);
        const result = parseFloat(parts[1].split(':')[1]);
        
        setIterations(prev => {
          const newIters = [...prev];
          if (iterNum >= 1 && iterNum <= 3) {
            newIters[iterNum - 1] = result;
          }
          return newIters;
        });

        // Mark the most recent point as a CFF point
        setChartData(prev => {
          if (prev.length === 0) return prev;
          const newData = [...prev];
          newData[newData.length - 1] = {
            ...newData[newData.length - 1],
            isCFF: true,
            cffLabel: `Iter ${iterNum}`
          };
          return newData;
        });
      } catch (e) {
        console.error("Failed to parse iteration result:", line);
      }
    } else if (line.startsWith('AVG:')) {
      const val = parseFloat(line.substring(4));
      if (!isNaN(val)) setAverage(val);
    }
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
                <li>FREQ:45.2</li>
                <li>ITER:1,RESULT:45.2</li>
                <li>AVG:44.8</li>
              </ul>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}

export default App;
