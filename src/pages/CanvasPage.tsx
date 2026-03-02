import React, { useRef, useEffect, useState } from 'react';
import { Trash2, Download, Eraser } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../utils/cn';

const COLORS = [
    '#000000', // Black
    '#ffffff', // White
    '#f43f5e', // Rose 500
    '#f59e0b', // Amber 500
    '#10b981', // Emerald 500
    '#3b82f6', // Blue 500
    '#8b5cf6', // Violet 500
    '#ec4899', // Pink 500
];

const BRUSH_SIZES = [2, 5, 10, 15, 20, 30];

const CanvasPage: React.FC = () => {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const contextRef = useRef<CanvasRenderingContext2D | null>(null);
    
    const [isDrawing, setIsDrawing] = useState(false);
    const [color, setColor] = useState('#10b981');
    const [brushSize, setBrushSize] = useState(5);
    const [isEraser, setIsEraser] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Set canvas internal dimensions to match display size
        const resizeCanvas = () => {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            
            const context = canvas.getContext('2d');
            if (context) {
                context.scale(window.devicePixelRatio, window.devicePixelRatio);
                context.lineCap = 'round';
                context.lineJoin = 'round';
                context.strokeStyle = color;
                context.lineWidth = brushSize;
                contextRef.current = context;
                
                // Set background to white or transparent? 
                // Let's keep it transparent but handle export
            }
        };

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        return () => window.removeEventListener('resize', resizeCanvas);
    }, []);

    useEffect(() => {
        if (contextRef.current) {
            contextRef.current.strokeStyle = isEraser ? '#ffffff' : color; // Eraser is just white for now or global composite operation
            contextRef.current.lineWidth = brushSize;
            
            if (isEraser) {
                contextRef.current.globalCompositeOperation = 'destination-out';
            } else {
                contextRef.current.globalCompositeOperation = 'source-over';
            }
        }
    }, [color, brushSize, isEraser]);

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
        const { offsetX, offsetY } = getCoordinates(e);
        contextRef.current?.beginPath();
        contextRef.current?.moveTo(offsetX, offsetY);
        setIsDrawing(true);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing) return;
        const { offsetX, offsetY } = getCoordinates(e);
        contextRef.current?.lineTo(offsetX, offsetY);
        contextRef.current?.stroke();
    };

    const stopDrawing = () => {
        contextRef.current?.closePath();
        setIsDrawing(false);
    };

    const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
        if ('nativeEvent' in e && e.nativeEvent instanceof MouseEvent) {
            return { offsetX: e.nativeEvent.offsetX, offsetY: e.nativeEvent.offsetY };
        } else {
            const touch = (e as React.TouchEvent).touches[0];
            const rect = canvasRef.current?.getBoundingClientRect();
            return {
                offsetX: touch.clientX - (rect?.left || 0),
                offsetY: touch.clientY - (rect?.top || 0)
            };
        }
    };

    const clearCanvas = () => {
        const canvas = canvasRef.current;
        const context = contextRef.current;
        if (canvas && context) {
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    const downloadImage = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Create a temporary canvas with white background for JPEG export or keep transparent for PNG
        const link = document.createElement('a');
        link.download = `art-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    return (
        <div className="flex flex-col h-[calc(100vh-140px)] gap-4 p-4 animate-in fade-in duration-500">
            {/* Toolbar */}
            <div className="flex items-center justify-between p-4 bg-base-200/50 backdrop-blur-md rounded-2xl border border-base-300 shadow-xl">
                <div className="flex items-center gap-6">
                    {/* Colors */}
                    <div className="flex items-center gap-2">
                        {COLORS.map((c) => (
                            <button
                                key={c}
                                onClick={() => { setColor(c); setIsEraser(false); }}
                                className={cn(
                                    "w-8 h-8 rounded-full border-2 transition-all hover:scale-110 active:scale-95",
                                    color === c && !isEraser ? "border-primary scale-110 shadow-lg" : "border-transparent"
                                )}
                                style={{ backgroundColor: c }}
                            />
                        ))}
                    </div>

                    <div className="h-8 w-px bg-base-300" />

                    {/* Brush Size */}
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-base-content/70 uppercase tracking-wider">Size</span>
                        <div className="flex items-center gap-1 bg-base-300/30 p-1 rounded-lg">
                            {BRUSH_SIZES.map(size => (
                                <button
                                    key={size}
                                    onClick={() => setBrushSize(size)}
                                    className={cn(
                                        "w-8 h-8 rounded flex items-center justify-center transition-all",
                                        brushSize === size ? "bg-primary text-primary-content shadow-md" : "hover:bg-base-300"
                                    )}
                                >
                                    <div 
                                        className="rounded-full bg-current" 
                                        style={{ width: Math.max(2, size/2), height: Math.max(2, size/2) }} 
                                    />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsEraser(!isEraser)}
                        className={cn(
                            "btn btn-square btn-ghost transition-all",
                            isEraser && "bg-primary/20 text-primary border-primary/50"
                        )}
                        title="Eraser"
                    >
                        <Eraser size={20} />
                    </button>
                    <button
                        onClick={clearCanvas}
                        className="btn btn-square btn-ghost text-error hover:bg-error/10"
                        title="Clear All"
                    >
                        <Trash2 size={20} />
                    </button>
                    <div className="h-8 w-px bg-base-300 mx-1" />
                    <button
                        onClick={downloadImage}
                        className="btn btn-primary gap-2 shadow-lg shadow-primary/20"
                    >
                        <Download size={18} />
                        {t('common.export', 'Export')}
                    </button>
                </div>
            </div>

            {/* Canvas Area */}
            <div className="flex-1 relative bg-white rounded-3xl overflow-hidden shadow-inner border border-base-300 cursor-crosshair group">
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                     style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '24px 24px' }} 
                />
                
                <canvas
                    ref={canvasRef}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="absolute inset-0 w-full h-full touch-none"
                />
                
                {/* Floating Hint */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-black/50 backdrop-blur-md text-white text-xs rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Click and drag to draw your masterpiece
                </div>
            </div>
        </div>
    );
};

export default CanvasPage;
