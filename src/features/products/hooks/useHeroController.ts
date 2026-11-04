'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PublicBusiness } from '@/types/business';

import { compressImageToMaxSize } from '@/shared/utils/image';
import { addHeroImage, deleteHeroImage, removeBusinessCover } from '@app/actions/business';

interface HeroControllerParams {
  business: PublicBusiness | null;
}

interface MenuElement extends HTMLElement {
  anchorElement?: HTMLElement;
  open?: boolean;
}

export type HeroBusiness = PublicBusiness;

interface SnackbarState {
  open: boolean;
  description: string;
  color: 'success' | 'error' | 'warning' | 'primary';
  icon?: string;
}

const DEFAULT_SNACKBAR: SnackbarState = {
  open: false,
  description: '',
  color: 'primary',
};

const AUTOPLAY_INTERVAL = 6000; // 6s entre slides
const SWIPE_THRESHOLD = 50;

function getCursorStyle(isEditing: boolean, isDragging: boolean) {
  if (!isEditing) return 'default';
  return isDragging ? 'grabbing' : 'grab';
}

async function processHeroImage(
  backgroundImage: string,
  heroRef: HTMLDivElement,
  position: { x: number; y: number },
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('No se pudo cargar la imagen'));
    img.src = backgroundImage;
  });

  const containerWidth = heroRef.offsetWidth;
  const containerHeight = heroRef.offsetHeight;
  const targetWidth = 1920;
  const scaleFactor = targetWidth / containerWidth;
  const targetHeight = containerHeight * scaleFactor;
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const imgRatio = img.width / img.height;
  const containerRatio = containerWidth / containerHeight;
  let renderWidth = containerWidth;
  let renderHeight = containerHeight;
  if (containerRatio > imgRatio) {
    renderHeight = containerWidth / imgRatio;
  } else {
    renderWidth = containerHeight * imgRatio;
  }

  if (ctx) {
    const centerOffsetX = (containerWidth - renderWidth) / 2;
    const centerOffsetY = (containerHeight - renderHeight) / 2;
    ctx.drawImage(
      img,
      (centerOffsetX + position.x) * scaleFactor,
      (centerOffsetY + position.y) * scaleFactor,
      renderWidth * scaleFactor,
      renderHeight * scaleFactor,
    );
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
  });
}

export function useHeroController({ business }: HeroControllerParams) {
  const initialImages = (business?.heroImages || []).filter(Boolean);

  const [images, setImages] = useState<string[]>(initialImages);
  const [activeSlide, setActiveSlide] = useState(0);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [snackbar, setSnackbar] = useState<SnackbarState>(DEFAULT_SNACKBAR);
  const [isPaused, setIsPaused] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isManuallyUpdating = useRef(false);

  // Derived values
  const backgroundImage = images[activeSlide] || null;
  const imagesCount = images.length;
  const hasMultipleImages = images.length > 1;
  const maxImagesReached = images.length >= 3;

  // ─── Sync images from business prop ──────────────────────
  useEffect(() => {
    if (isManuallyUpdating.current) return;

    const synced = (business?.heroImages || []).filter(Boolean);
    setImages((prev) => {
      // Sólo actualizar si cambió realmente (evita loops)
      if (JSON.stringify(prev) === JSON.stringify(synced)) return prev;
      return synced;
    });
  }, [business?.heroImages]);

  // Ajustar activeSlide si se sale del rango
  useEffect(() => {
    if (activeSlide >= images.length && images.length > 0) {
      setActiveSlide(0);
    }
  }, [images.length, activeSlide]);

  // ─── Autoplay ────────────────────────────────────────────
  const stopAutoplay = useCallback(() => {
    if (autoplayRef.current) {
      clearInterval(autoplayRef.current);
      autoplayRef.current = null;
    }
  }, []);

  const startAutoplay = useCallback(() => {
    if (autoplayRef.current) clearInterval(autoplayRef.current);
    if (images.length <= 1) return;

    autoplayRef.current = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % images.length);
    }, AUTOPLAY_INTERVAL);
  }, [images.length]);

  useEffect(() => {
    if (!isPaused && images.length > 1 && !isEditing) {
      startAutoplay();
    } else {
      stopAutoplay();
    }
    return stopAutoplay;
  }, [isPaused, images.length, isEditing, startAutoplay, stopAutoplay]);

  const handleMouseEnter = () => setIsPaused(true);
  const handleMouseLeave = () => setIsPaused(false);

  const goToSlide = (index: number) => {
    if (index === activeSlide) return;
    setActiveSlide(index);
    stopAutoplay();
  };

  const goNext = () => {
    setActiveSlide((prev) => (prev + 1) % images.length);
    stopAutoplay();
  };

  const goPrev = () => {
    setActiveSlide((prev) => (prev - 1 + images.length) % images.length);
    stopAutoplay();
  };

  // ─── Swipe táctil ────────────────────────────────────────
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isEditing) return;

    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) * 1.5 > Math.abs(dy)) {
      if (dx > 0) goPrev();
      else goNext();
    }
  };

  // ─── Upload / Add image ──────────────────────────────────
  const handleUploadClick = () => {
    if (menuRef.current) {
      (menuRef.current as unknown as MenuElement).open = false;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      setImages((prev) => [...prev, dataUrl]);
      setActiveSlide(images.length);
      setIsEditing(true);
      setPosition({ x: 0, y: 0 });
    };
    reader.onerror = () => {
      setSnackbar({
        open: true,
        description: 'Error al leer la imagen',
        color: 'error',
        icon: 'error',
      });
    };
    reader.readAsDataURL(file);
  };

  // ─── Drag positioning ────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isEditing) return;
    setIsDragging(true);
    setDragStart({
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // ─── Delete current slide ────────────────────────────────
  const handleDeleteClick = (index?: number) => {
    if (menuRef.current) {
      (menuRef.current as unknown as MenuElement).open = false;
    }

    const targetIndex = index ?? activeSlide;
    const url = images[targetIndex];

    // Imagen local (blob o data-url, aún no subida) → solo del estado
    if (url.startsWith('blob:') || url.startsWith('data:')) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      setImages((prev) => prev.filter((_, i) => i !== targetIndex));
      if (targetIndex <= activeSlide && activeSlide > 0) {
        setActiveSlide((prev) => prev - 1);
      }
      return;
    }

    // Imagen ya persistida → server action
    if (!business) return;
    isManuallyUpdating.current = true;

    deleteHeroImage(business.id, business.slug, targetIndex)
      .then((result) => {
        if (result.success) {
          setImages((prev) => prev.filter((_, i) => i !== targetIndex));
          if (targetIndex <= activeSlide && activeSlide > 0) {
            setActiveSlide((prev) => prev - 1);
          }
          setSnackbar({
            open: true,
            description: 'Imagen eliminada',
            color: 'success',
            icon: 'delete',
          });
          window.dispatchEvent(new CustomEvent('business-data-updated'));
        } else {
          setSnackbar({
            open: true,
            description: result.error || 'Error al eliminar',
            color: 'error',
            icon: 'error',
          });
        }
      })
      .catch(() => {
        setSnackbar({
          open: true,
          description: 'Error al eliminar',
          color: 'error',
          icon: 'error',
        });
      })
      .finally(() => {
        setTimeout(() => {
          isManuallyUpdating.current = false;
        }, 2000);
      });
  };

  // ─── Delete all ──────────────────────────────────────────
  const handleDeleteAllClick = () => {
    if (menuRef.current) {
      (menuRef.current as unknown as MenuElement).open = false;
    }
    setShowDeleteDialog(true);
  };

  const confirmDeleteBackground = async () => {
    if (!business) return;
    setShowDeleteDialog(false);
    isManuallyUpdating.current = true;

    try {
      const result = await removeBusinessCover(business.id, business.slug);
      if (result.success) {
        setImages([]);
        setActiveSlide(0);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        setSnackbar({
          open: true,
          description: 'Publicidad eliminada',
          color: 'success',
          icon: 'delete',
        });
        window.dispatchEvent(new CustomEvent('business-data-updated'));
      }
    } catch {
      setSnackbar({
        open: true,
        description: 'Error al eliminar',
        color: 'error',
        icon: 'error',
      });
    } finally {
      setTimeout(() => {
        isManuallyUpdating.current = false;
      }, 2000);
    }
  };

  // ─── Cancel editing ──────────────────────────────────────
  const handleCancel = () => {
    setIsEditing(false);
    const synced = (business?.heroImages || []).filter(Boolean);
    setImages(synced);
    setPosition({ x: 0, y: 0 });
    if (activeSlide >= synced.length) {
      setActiveSlide(Math.max(0, synced.length - 1));
    }
  };

  // ─── Save (process + upload) ─────────────────────────────
  const uploadCover = async (blob: Blob, localUrl: string) => {
    if (!business) return;

    try {
      const compressedFile = await compressImageToMaxSize(
        new File([blob], 'hero.jpg', { type: 'image/jpeg' }),
      );
      const formData = new FormData();
      formData.append('file', compressedFile);
      const result = await addHeroImage(business.id, business.slug, formData);

      if (result.success && result.url) {
        const uploadedUrl = result.url;
        // Reemplazar la URL local (blob) por la real
        setImages((prev) => prev.map((u) => (u === localUrl ? uploadedUrl : u)));
        window.dispatchEvent(new CustomEvent('business-data-updated'));
      } else {
        throw new Error(result.error || 'Error al subir');
      }
    } catch (error: unknown) {
      // Revertir: sacar la imagen local del array
      setImages((prev) => prev.filter((u) => u !== localUrl));
      setSnackbar({
        open: true,
        description: error instanceof Error ? error.message : 'Error al guardar.',
        color: 'error',
        icon: 'error',
      });
    } finally {
      URL.revokeObjectURL(localUrl);
      setTimeout(() => {
        isManuallyUpdating.current = false;
      }, 3000);
    }
  };

  const handleSave = async () => {
    if (!business || !heroRef.current) return;

    // Buscar la imagen local (blob o data-url) activa para procesar
    const editingImage = images[activeSlide];
    if (!editingImage || (!editingImage.startsWith('blob:') && !editingImage.startsWith('data:')))
      return;

    setIsSaving(true);
    try {
      const blob = await processHeroImage(editingImage, heroRef.current, position);
      if (!blob) {
        setIsSaving(false);
        setSnackbar({
          open: true,
          description: 'Error al procesar la imagen. Probá con otro archivo.',
          color: 'error',
          icon: 'error',
        });
        return;
      }

      const localUrl = URL.createObjectURL(blob);
      setIsEditing(false);
      isManuallyUpdating.current = true;

      // Reemplazar blob original por el procesado
      setImages((prev) => prev.map((u) => (u === editingImage ? localUrl : u)));

      setSnackbar({
        open: true,
        description: 'Publicidad guardada exitosamente.',
        color: 'success',
        icon: 'check_circle',
      });
      setIsSaving(false);

      uploadCover(blob, localUrl);
    } catch {
      setIsSaving(false);
      setSnackbar({
        open: true,
        description: 'Error al procesar la imagen. Probá con otro archivo.',
        color: 'error',
        icon: 'error',
      });
    }
  };

  // ─── Menu ────────────────────────────────────────────────
  const handleMenuClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (menuRef.current) {
      const menu = menuRef.current as unknown as MenuElement;
      menu.open = !menu.open;
    }
  };

  return {
    // State
    images,
    activeSlide,
    backgroundImage,
    backgroundPositionStyle: isEditing
      ? `calc(50% + ${position.x}px) calc(50% + ${position.y}px)`
      : 'center',
    cursorStyle: getCursorStyle(isEditing, isDragging),
    isEditing,
    isSaving,
    isPaused,
    isDragging,
    showDeleteDialog,
    snackbar,
    imagesCount,
    maxImagesReached,
    hasMultipleImages,

    // Refs
    heroRef,
    fileInputRef,
    menuRef,

    // Actions
    confirmDeleteBackground,
    goNext,
    goPrev,
    goToSlide,
    handleTouchStart,
    handleTouchEnd,
    handleCancel,
    handleDeleteAllClick,
    handleDeleteClick,
    handleFileChange,
    handleMenuClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseEnter,
    handleMouseLeave,
    handleSave,
    handleUploadClick,
    setShowDeleteDialog,
    setSnackbar,
  };
}
