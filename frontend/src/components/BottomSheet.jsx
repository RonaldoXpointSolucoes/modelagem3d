import { AnimatePresence, motion, useDragControls } from 'framer-motion';

/**
 * Gaveta de baixo para cima. Arraste pela alça para fechar (assim listas e controles
 * deslizantes dentro dela não arrastam a gaveta sem querer).
 * modal=false: sem fundo escurecido e mais baixa, para ver a cena enquanto ajusta.
 */
export default function BottomSheet({ open, onClose, children, dismissable = true, modal = true }) {
  const controls = useDragControls();
  return (
    <AnimatePresence>
      {open && (
        <>
          {modal && (
            <motion.div
              className="sheet-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => dismissable && onClose?.()}
            />
          )}
          <motion.div
            className={`sheet glass ${modal ? '' : 'compact'}`}
            role="dialog"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            drag={dismissable ? 'y' : false}
            dragListener={false}
            dragControls={controls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, i) => { if (i.offset.y > 120 || i.velocity.y > 600) onClose?.(); }}
          >
            <div className="grabber-zone" onPointerDown={(e) => dismissable && controls.start(e)}>
              <div className="grabber" />
              {!modal && <button className="sheet-close" aria-label="Fechar" onClick={onClose}>✕</button>}
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
