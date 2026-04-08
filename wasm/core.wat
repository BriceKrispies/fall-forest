(module
  (memory (export "memory") 64)

  (global $tri_count (mut i32) (i32.const 0))
  (global $visible_count (mut i32) (i32.const 0))
  (global $screen_w (mut f32) (f32.const 320))
  (global $screen_h (mut f32) (f32.const 200))
  (global $hw (mut f32) (f32.const 160))
  (global $hh (mut f32) (f32.const 100))
  (global $time (mut f32) (f32.const 0))
  (global $leaf_count (mut i32) (i32.const 0))
  (global $grass_count (mut i32) (i32.const 0))
  (global $grass_total (mut i32) (i32.const 0))
  (global $creature_count (mut i32) (i32.const 0))

  (global $OFF_MVP i32 (i32.const 0))
  (global $OFF_CAM i32 (i32.const 64))
  (global $OFF_SUN i32 (i32.const 80))
  (global $OFF_CONSTANTS i32 (i32.const 96))
  (global $OFF_METRICS i32 (i32.const 128))
  (global $OFF_TRI_IN i32 (i32.const 256))
  (global $MAX_TRIS i32 (i32.const 28000))
  (global $OFF_TRI_OUT i32 (i32.const 1344256))
  (global $OFF_LEAVES i32 (i32.const 2688256))
  (global $MAX_LEAVES i32 (i32.const 64))
  (global $OFF_GRASS i32 (i32.const 2690304))
  (global $MAX_GRASS i32 (i32.const 2000))
  (global $OFF_CREATURES i32 (i32.const 2754304))
  (global $MAX_CREATURES i32 (i32.const 16))

  ;; Horror entity system
  (global $OFF_HORROR_CFG i32 (i32.const 2760000))    ;; 32 bytes config
  (global $OFF_HORROR_ENT i32 (i32.const 2760032))    ;; 8 entities × 64 bytes = 512
  (global $OFF_HORROR_SEG i32 (i32.const 2760544))    ;; 512 segments × 48 bytes = 24576
  (global $MAX_HORROR_ENT i32 (i32.const 8))
  (global $MAX_HORROR_SEG i32 (i32.const 512))
  (global $HORROR_ENT_STRIDE i32 (i32.const 64))
  (global $HORROR_SEG_STRIDE i32 (i32.const 48))
  (global $horror_active_ent (mut i32) (i32.const 0))
  (global $horror_active_seg (mut i32) (i32.const 0))

  ;; Point lights (fire/lamp): up to 8 lights, each 16 bytes (x, y, z, radius)
  ;; Count at offset 156, light data at offset 160
  (global $OFF_LIGHT_COUNT i32 (i32.const 156))
  (global $OFF_LIGHTS i32 (i32.const 160))
  (global $MAX_LIGHTS i32 (i32.const 8))

  (func $f32_load (param $off i32) (result f32)
    (f32.load (local.get $off))
  )

  (func $mvp (param $row i32) (param $col i32) (result f32)
    (f32.load (i32.add
      (global.get $OFF_MVP)
      (i32.mul (i32.add (i32.mul (local.get $row) (i32.const 4)) (local.get $col)) (i32.const 4))
    ))
  )

  (func $cam_x (result f32) (f32.load (global.get $OFF_CAM)))
  (func $cam_y (result f32) (f32.load (i32.add (global.get $OFF_CAM) (i32.const 4))))
  (func $cam_z (result f32) (f32.load (i32.add (global.get $OFF_CAM) (i32.const 8))))

  (func $sun_x (result f32) (f32.load (global.get $OFF_SUN)))
  (func $sun_y (result f32) (f32.load (i32.add (global.get $OFF_SUN) (i32.const 4))))
  (func $sun_z (result f32) (f32.load (i32.add (global.get $OFF_SUN) (i32.const 8))))

  (func $fog_near (result f32) (f32.load (global.get $OFF_CONSTANTS)))
  (func $fog_far (result f32) (f32.load (i32.add (global.get $OFF_CONSTANTS) (i32.const 4))))
  (func $ambient (result f32) (f32.load (i32.add (global.get $OFF_CONSTANTS) (i32.const 8))))

  (func $clamp (param $v f32) (param $lo f32) (param $hi f32) (result f32)
    (f32.min (f32.max (local.get $v) (local.get $lo)) (local.get $hi))
  )

  (func $lerp (param $a f32) (param $b f32) (param $t f32) (result f32)
    (f32.add (local.get $a) (f32.mul (f32.sub (local.get $b) (local.get $a)) (local.get $t)))
  )

  (func $smoothstep (param $lo f32) (param $hi f32) (param $v f32) (result f32)
    (local $x f32)
    (local.set $x (call $clamp
      (f32.div (f32.sub (local.get $v) (local.get $lo)) (f32.sub (local.get $hi) (local.get $lo)))
      (f32.const 0) (f32.const 1)
    ))
    (f32.mul (f32.mul (local.get $x) (local.get $x))
      (f32.sub (f32.const 3) (f32.mul (f32.const 2) (local.get $x)))
    )
  )

  (func $sqrt (param $v f32) (result f32) (f32.sqrt (local.get $v)))

  (func $transform_point (param $px f32) (param $py f32) (param $pz f32)
    (result f32 f32 f32 f32)
    (local $x f32) (local $y f32) (local $z f32) (local $w f32)
    (local.set $x (f32.add (f32.add
      (f32.mul (call $mvp (i32.const 0) (i32.const 0)) (local.get $px))
      (f32.mul (call $mvp (i32.const 0) (i32.const 1)) (local.get $py)))
      (f32.add
        (f32.mul (call $mvp (i32.const 0) (i32.const 2)) (local.get $pz))
        (call $mvp (i32.const 0) (i32.const 3)))))
    (local.set $y (f32.add (f32.add
      (f32.mul (call $mvp (i32.const 1) (i32.const 0)) (local.get $px))
      (f32.mul (call $mvp (i32.const 1) (i32.const 1)) (local.get $py)))
      (f32.add
        (f32.mul (call $mvp (i32.const 1) (i32.const 2)) (local.get $pz))
        (call $mvp (i32.const 1) (i32.const 3)))))
    (local.set $z (f32.add (f32.add
      (f32.mul (call $mvp (i32.const 2) (i32.const 0)) (local.get $px))
      (f32.mul (call $mvp (i32.const 2) (i32.const 1)) (local.get $py)))
      (f32.add
        (f32.mul (call $mvp (i32.const 2) (i32.const 2)) (local.get $pz))
        (call $mvp (i32.const 2) (i32.const 3)))))
    (local.set $w (f32.add (f32.add
      (f32.mul (call $mvp (i32.const 3) (i32.const 0)) (local.get $px))
      (f32.mul (call $mvp (i32.const 3) (i32.const 1)) (local.get $py)))
      (f32.add
        (f32.mul (call $mvp (i32.const 3) (i32.const 2)) (local.get $pz))
        (call $mvp (i32.const 3) (i32.const 3)))))
    (local.get $x) (local.get $y) (local.get $z) (local.get $w)
  )

  (func $project (param $px f32) (param $py f32) (param $pz f32)
    (result f32 f32 f32 i32)
    (local $x f32) (local $y f32) (local $z f32) (local $w f32) (local $inv f32)
    (call $transform_point (local.get $px) (local.get $py) (local.get $pz))
    (local.set $w) (local.set $z) (local.set $y) (local.set $x)
    (if (f32.le (local.get $w) (f32.const 0.001))
      (then (return (f32.const 0) (f32.const 0) (f32.const 0) (i32.const 0)))
    )
    (local.set $inv (f32.div (f32.const 1) (local.get $w)))
    (f32.add (global.get $hw) (f32.mul (f32.mul (local.get $x) (local.get $inv)) (global.get $hw)))
    (f32.sub (global.get $hh) (f32.mul (f32.mul (local.get $y) (local.get $inv)) (global.get $hh)))
    (f32.mul (local.get $z) (local.get $inv))
    (i32.const 1)
  )

  (func (export "set_screen") (param $w f32) (param $h f32)
    (global.set $screen_w (local.get $w))
    (global.set $screen_h (local.get $h))
    (global.set $hw (f32.div (local.get $w) (f32.const 2)))
    (global.set $hh (f32.div (local.get $h) (f32.const 2)))
  )

  (func (export "set_tri_count") (param $n i32)
    (global.set $tri_count (local.get $n))
  )

  (func (export "get_visible_count") (result i32)
    (global.get $visible_count)
  )

  (func (export "get_metrics_ptr") (result i32)
    (global.get $OFF_METRICS)
  )

  (func (export "get_tri_in_ptr") (result i32)
    (global.get $OFF_TRI_IN)
  )

  (func (export "get_tri_out_ptr") (result i32)
    (global.get $OFF_TRI_OUT)
  )

  (func (export "get_leaves_ptr") (result i32)
    (global.get $OFF_LEAVES)
  )

  (func (export "get_grass_ptr") (result i32)
    (global.get $OFF_GRASS)
  )

  (func (export "get_creatures_ptr") (result i32)
    (global.get $OFF_CREATURES)
  )

  (func (export "process_triangles") (result i32)
    (local $i i32)
    (local $in_off i32)
    (local $out_off i32)
    (local $vis i32)
    (local $v0x f32) (local $v0y f32) (local $v0z f32)
    (local $v1x f32) (local $v1y f32) (local $v1z f32)
    (local $v2x f32) (local $v2y f32) (local $v2z f32)
    (local $cr f32) (local $cg f32) (local $cb f32)
    (local $cx f32) (local $cz f32)
    (local $e1x f32) (local $e1y f32) (local $e1z f32)
    (local $e2x f32) (local $e2y f32) (local $e2z f32)
    (local $nx f32) (local $ny f32) (local $nz f32) (local $nlen f32)
    (local $tcx f32) (local $tcy f32) (local $tcz f32)
    (local $ndot f32)
    (local $p0x f32) (local $p0y f32) (local $p0z f32) (local $p0ok i32)
    (local $p1x f32) (local $p1y f32) (local $p1z f32) (local $p1ok i32)
    (local $p2x f32) (local $p2y f32) (local $p2z f32) (local $p2ok i32)
    (local $centx f32) (local $centy f32) (local $centz f32)
    (local $rawndl f32) (local $ndl f32) (local $ramp f32) (local $wrap f32) (local $light f32)
    (local $warmT f32) (local $tintR f32) (local $tintG f32) (local $tintB f32)
    (local $dx f32) (local $dy f32) (local $dz f32) (local $dist f32) (local $fog f32)
    (local $sr f32) (local $sg f32) (local $sb f32)
    (local $amb f32)
    (local $li i32) (local $light_off i32) (local $light_count i32)
    (local $lx f32) (local $ly f32) (local $lz f32) (local $lrad f32)
    (local $ldx f32) (local $ldy f32) (local $ldz f32) (local $ldist f32) (local $latt f32)

    (local.set $vis (i32.const 0))
    (local.set $i (i32.const 0))
    (local.set $in_off (global.get $OFF_TRI_IN))
    (local.set $out_off (global.get $OFF_TRI_OUT))
    (local.set $amb (call $ambient))

    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (global.get $tri_count)))

        (local.set $v0x (f32.load (local.get $in_off)))
        (local.set $v0y (f32.load (i32.add (local.get $in_off) (i32.const 4))))
        (local.set $v0z (f32.load (i32.add (local.get $in_off) (i32.const 8))))
        (local.set $v1x (f32.load (i32.add (local.get $in_off) (i32.const 12))))
        (local.set $v1y (f32.load (i32.add (local.get $in_off) (i32.const 16))))
        (local.set $v1z (f32.load (i32.add (local.get $in_off) (i32.const 20))))
        (local.set $v2x (f32.load (i32.add (local.get $in_off) (i32.const 24))))
        (local.set $v2y (f32.load (i32.add (local.get $in_off) (i32.const 28))))
        (local.set $v2z (f32.load (i32.add (local.get $in_off) (i32.const 32))))
        (local.set $cr (f32.load (i32.add (local.get $in_off) (i32.const 36))))
        (local.set $cg (f32.load (i32.add (local.get $in_off) (i32.const 40))))
        (local.set $cb (f32.load (i32.add (local.get $in_off) (i32.const 44))))

        (local.set $cx (f32.sub
          (f32.div (f32.add (f32.add (local.get $v0x) (local.get $v1x)) (local.get $v2x)) (f32.const 3))
          (call $cam_x)))
        (local.set $cz (f32.sub
          (f32.div (f32.add (f32.add (local.get $v0z) (local.get $v1z)) (local.get $v2z)) (f32.const 3))
          (call $cam_z)))

        (if (f32.gt (f32.add (f32.mul (local.get $cx) (local.get $cx)) (f32.mul (local.get $cz) (local.get $cz))) (f32.const 3600))
          (then
            (local.set $in_off (i32.add (local.get $in_off) (i32.const 48)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)
          )
        )

        (local.set $e1x (f32.sub (local.get $v1x) (local.get $v0x)))
        (local.set $e1y (f32.sub (local.get $v1y) (local.get $v0y)))
        (local.set $e1z (f32.sub (local.get $v1z) (local.get $v0z)))
        (local.set $e2x (f32.sub (local.get $v2x) (local.get $v0x)))
        (local.set $e2y (f32.sub (local.get $v2y) (local.get $v0y)))
        (local.set $e2z (f32.sub (local.get $v2z) (local.get $v0z)))

        (local.set $nx (f32.sub (f32.mul (local.get $e1y) (local.get $e2z)) (f32.mul (local.get $e1z) (local.get $e2y))))
        (local.set $ny (f32.sub (f32.mul (local.get $e1z) (local.get $e2x)) (f32.mul (local.get $e1x) (local.get $e2z))))
        (local.set $nz (f32.sub (f32.mul (local.get $e1x) (local.get $e2y)) (f32.mul (local.get $e1y) (local.get $e2x))))

        (local.set $nlen (f32.sqrt (f32.add (f32.add
          (f32.mul (local.get $nx) (local.get $nx))
          (f32.mul (local.get $ny) (local.get $ny)))
          (f32.mul (local.get $nz) (local.get $nz)))))

        (if (f32.lt (local.get $nlen) (f32.const 0.0001))
          (then
            (local.set $in_off (i32.add (local.get $in_off) (i32.const 48)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)
          )
        )

        (local.set $nx (f32.div (local.get $nx) (local.get $nlen)))
        (local.set $ny (f32.div (local.get $ny) (local.get $nlen)))
        (local.set $nz (f32.div (local.get $nz) (local.get $nlen)))

        (local.set $tcx (f32.sub (call $cam_x) (local.get $v0x)))
        (local.set $tcy (f32.sub (call $cam_y) (local.get $v0y)))
        (local.set $tcz (f32.sub (call $cam_z) (local.get $v0z)))
        (local.set $ndot (f32.add (f32.add
          (f32.mul (local.get $nx) (local.get $tcx))
          (f32.mul (local.get $ny) (local.get $tcy)))
          (f32.mul (local.get $nz) (local.get $tcz))))

        (if (f32.lt (local.get $ndot) (f32.const 0))
          (then
            (local.set $in_off (i32.add (local.get $in_off) (i32.const 48)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)
          )
        )

        (call $project (local.get $v0x) (local.get $v0y) (local.get $v0z))
        (local.set $p0ok) (local.set $p0z) (local.set $p0y) (local.set $p0x)
        (call $project (local.get $v1x) (local.get $v1y) (local.get $v1z))
        (local.set $p1ok) (local.set $p1z) (local.set $p1y) (local.set $p1x)
        (call $project (local.get $v2x) (local.get $v2y) (local.get $v2z))
        (local.set $p2ok) (local.set $p2z) (local.set $p2y) (local.set $p2x)

        (if (i32.or (i32.or (i32.eqz (local.get $p0ok)) (i32.eqz (local.get $p1ok))) (i32.eqz (local.get $p2ok)))
          (then
            (local.set $in_off (i32.add (local.get $in_off) (i32.const 48)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)
          )
        )

        ;; Frustum culling — DISABLED for debugging, uncomment to re-enable
        ;; (if (i32.or
        ;;   (i32.or
        ;;     (i32.and (i32.and
        ;;       (f32.lt (local.get $p0x) (f32.const 0))
        ;;       (f32.lt (local.get $p1x) (f32.const 0)))
        ;;       (f32.lt (local.get $p2x) (f32.const 0)))
        ;;     (i32.and (i32.and
        ;;       (f32.gt (local.get $p0x) (global.get $screen_w))
        ;;       (f32.gt (local.get $p1x) (global.get $screen_w)))
        ;;       (f32.gt (local.get $p2x) (global.get $screen_w))))
        ;;   (i32.or
        ;;     (i32.and (i32.and
        ;;       (f32.lt (local.get $p0y) (f32.const 0))
        ;;       (f32.lt (local.get $p1y) (f32.const 0)))
        ;;       (f32.lt (local.get $p2y) (f32.const 0)))
        ;;     (i32.and (i32.and
        ;;       (f32.gt (local.get $p0y) (global.get $screen_h))
        ;;       (f32.gt (local.get $p1y) (global.get $screen_h)))
        ;;       (f32.gt (local.get $p2y) (global.get $screen_h)))))
        ;;   (then
        ;;     (local.set $in_off (i32.add (local.get $in_off) (i32.const 48)))
        ;;     (local.set $i (i32.add (local.get $i) (i32.const 1)))
        ;;     (br $loop)
        ;;   )
        ;; )

        (local.set $centx (f32.add (local.get $cx) (call $cam_x)))
        (local.set $centy (f32.div (f32.add (f32.add (local.get $v0y) (local.get $v1y)) (local.get $v2y)) (f32.const 3)))
        (local.set $centz (f32.add (local.get $cz) (call $cam_z)))

        (local.set $rawndl (f32.add (f32.add
          (f32.mul (local.get $nx) (call $sun_x))
          (f32.mul (local.get $ny) (call $sun_y)))
          (f32.mul (local.get $nz) (call $sun_z))))
        (local.set $ndl (call $clamp (local.get $rawndl) (f32.const 0) (f32.const 1)))
        (local.set $ramp (f32.mul (f32.mul (local.get $ndl) (local.get $ndl))
          (f32.sub (f32.const 3) (f32.mul (f32.const 2) (local.get $ndl)))))
        (local.set $wrap (call $clamp (f32.add (f32.mul (local.get $rawndl) (f32.const 0.5)) (f32.const 0.5)) (f32.const 0) (f32.const 1)))
        (local.set $light (f32.add (local.get $amb)
          (f32.mul (f32.sub (f32.const 1) (local.get $amb))
            (f32.add (f32.mul (local.get $ramp) (f32.const 0.8)) (f32.mul (local.get $wrap) (f32.const 0.2))))))

        (local.set $warmT (local.get $ramp))
        (local.set $tintR (call $lerp (f32.const 0.4) (f32.const 1.05) (local.get $warmT)))
        (local.set $tintG (call $lerp (f32.const 0.5) (f32.const 0.93) (local.get $warmT)))
        (local.set $tintB (call $lerp (f32.const 0.68) (f32.const 0.72) (local.get $warmT)))

        (local.set $sr (f32.mul (f32.mul (local.get $cr) (local.get $tintR)) (local.get $light)))
        (local.set $sg (f32.mul (f32.mul (local.get $cg) (local.get $tintG)) (local.get $light)))
        (local.set $sb (f32.mul (f32.mul (local.get $cb) (local.get $tintB)) (local.get $light)))

        ;; Point light contribution
        (local.set $light_count (i32.load (global.get $OFF_LIGHT_COUNT)))
        (local.set $li (i32.const 0))
        (local.set $light_off (global.get $OFF_LIGHTS))
        (block $lbreak
          (loop $lloop
            (br_if $lbreak (i32.ge_u (local.get $li) (local.get $light_count)))

            (local.set $lx (f32.load (local.get $light_off)))
            (local.set $ly (f32.load (i32.add (local.get $light_off) (i32.const 4))))
            (local.set $lz (f32.load (i32.add (local.get $light_off) (i32.const 8))))
            (local.set $lrad (f32.load (i32.add (local.get $light_off) (i32.const 12))))

            (local.set $ldx (f32.sub (local.get $centx) (local.get $lx)))
            (local.set $ldy (f32.sub (local.get $centy) (local.get $ly)))
            (local.set $ldz (f32.sub (local.get $centz) (local.get $lz)))
            (local.set $ldist (f32.sqrt (f32.add (f32.add
              (f32.mul (local.get $ldx) (local.get $ldx))
              (f32.mul (local.get $ldy) (local.get $ldy)))
              (f32.mul (local.get $ldz) (local.get $ldz)))))

            ;; Attenuation: smoothstep falloff from 0 at radius to 1 at center
            (if (f32.lt (local.get $ldist) (local.get $lrad))
              (then
                (local.set $latt (call $smoothstep (local.get $lrad) (f32.const 0) (local.get $ldist)))
                ;; Warm firelight: add (att * color_channel * warm_tint)
                ;; Tint: R=1.0, G=0.6, B=0.2 — warm orange
                (local.set $sr (f32.add (local.get $sr)
                  (f32.mul (local.get $latt) (f32.mul (local.get $cr) (f32.const 1.0)))))
                (local.set $sg (f32.add (local.get $sg)
                  (f32.mul (local.get $latt) (f32.mul (local.get $cg) (f32.const 0.6)))))
                (local.set $sb (f32.add (local.get $sb)
                  (f32.mul (local.get $latt) (f32.mul (local.get $cb) (f32.const 0.2)))))
              )
            )

            (local.set $light_off (i32.add (local.get $light_off) (i32.const 16)))
            (local.set $li (i32.add (local.get $li) (i32.const 1)))
            (br $lloop)
          )
        )

        (local.set $dx (f32.sub (local.get $centx) (call $cam_x)))
        (local.set $dy (f32.sub (local.get $centy) (call $cam_y)))
        (local.set $dz (f32.sub (local.get $centz) (call $cam_z)))
        (local.set $dist (f32.sqrt (f32.add (f32.add
          (f32.mul (local.get $dx) (local.get $dx))
          (f32.mul (local.get $dy) (local.get $dy)))
          (f32.mul (local.get $dz) (local.get $dz)))))
        (local.set $fog (call $smoothstep (call $fog_near) (call $fog_far) (local.get $dist)))

        (local.set $sr (call $clamp (call $lerp (local.get $sr) (f32.const 0.82) (local.get $fog)) (f32.const 0) (f32.const 1)))
        (local.set $sg (call $clamp (call $lerp (local.get $sg) (f32.const 0.78) (local.get $fog)) (f32.const 0) (f32.const 1)))
        (local.set $sb (call $clamp (call $lerp (local.get $sb) (f32.const 0.65) (local.get $fog)) (f32.const 0) (f32.const 1)))

        (f32.store (local.get $out_off) (local.get $p0x))
        (f32.store (i32.add (local.get $out_off) (i32.const 4)) (local.get $p0y))
        (f32.store (i32.add (local.get $out_off) (i32.const 8)) (local.get $p0z))
        (f32.store (i32.add (local.get $out_off) (i32.const 12)) (local.get $p1x))
        (f32.store (i32.add (local.get $out_off) (i32.const 16)) (local.get $p1y))
        (f32.store (i32.add (local.get $out_off) (i32.const 20)) (local.get $p1z))
        (f32.store (i32.add (local.get $out_off) (i32.const 24)) (local.get $p2x))
        (f32.store (i32.add (local.get $out_off) (i32.const 28)) (local.get $p2y))
        (f32.store (i32.add (local.get $out_off) (i32.const 32)) (local.get $p2z))
        (f32.store (i32.add (local.get $out_off) (i32.const 36)) (local.get $sr))
        (f32.store (i32.add (local.get $out_off) (i32.const 40)) (local.get $sg))
        (f32.store (i32.add (local.get $out_off) (i32.const 44)) (local.get $sb))

        (local.set $out_off (i32.add (local.get $out_off) (i32.const 48)))
        (local.set $vis (i32.add (local.get $vis) (i32.const 1)))

        (local.set $in_off (i32.add (local.get $in_off) (i32.const 48)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (global.set $visible_count (local.get $vis))

    (i32.store (global.get $OFF_METRICS) (global.get $tri_count))
    (i32.store (i32.add (global.get $OFF_METRICS) (i32.const 4)) (local.get $vis))

    (local.get $vis)
  )

  (func (export "update_leaves") (param $dt f32) (param $cam_x f32) (param $cam_z f32) (param $seed f32)
    (local $i i32)
    (local $off i32)
    (local $x f32) (local $y f32) (local $z f32)
    (local $vx f32) (local $vy f32) (local $vz f32)
    (local $life f32) (local $max_life f32)
    (local $active i32)
    (local $phase f32)

    (local.set $i (i32.const 0))
    (local.set $off (global.get $OFF_LEAVES))
    (local.set $active (i32.const 0))

    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (global.get $MAX_LEAVES)))

        (local.set $x (f32.load (local.get $off)))
        (local.set $y (f32.load (i32.add (local.get $off) (i32.const 4))))
        (local.set $z (f32.load (i32.add (local.get $off) (i32.const 8))))
        (local.set $vx (f32.load (i32.add (local.get $off) (i32.const 12))))
        (local.set $vy (f32.load (i32.add (local.get $off) (i32.const 16))))
        (local.set $vz (f32.load (i32.add (local.get $off) (i32.const 20))))
        (local.set $life (f32.load (i32.add (local.get $off) (i32.const 24))))
        (local.set $max_life (f32.load (i32.add (local.get $off) (i32.const 28))))

        (if (f32.le (local.get $life) (f32.const 0))
          (then
            (local.set $phase (f32.add (local.get $seed) (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 7.31))))

            (if (f32.lt
                  (f32.sub
                    (f32.mul
                      (f32.sub
                        (f32.mul (local.get $phase) (f32.const 43758.5453))
                        (f32.trunc (f32.mul (local.get $phase) (f32.const 43758.5453)))
                      )
                      (f32.const 1.0)
                    )
                    (f32.mul
                      (f32.sub
                        (f32.mul (local.get $phase) (f32.const 43758.5453))
                        (f32.trunc (f32.mul (local.get $phase) (f32.const 43758.5453)))
                      )
                      (f32.const 1.0)
                    )
                  )
                  (f32.mul (local.get $dt) (f32.const 0.3))
                )
              (then
                (local.set $phase (f32.add (local.get $seed) (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 13.17))))
                (f32.store (local.get $off)
                  (f32.add (local.get $cam_x) (f32.sub (f32.mul
                    (f32.sub (f32.mul (local.get $phase) (f32.const 12.9898))
                      (f32.trunc (f32.mul (local.get $phase) (f32.const 12.9898))))
                    (f32.const 12.0)) (f32.const 6.0))))
                (f32.store (i32.add (local.get $off) (i32.const 4))
                  (f32.add (f32.const 3.0)
                    (f32.mul
                      (f32.sub (f32.mul (f32.add (local.get $phase) (f32.const 3.3)) (f32.const 7.7777))
                        (f32.trunc (f32.mul (f32.add (local.get $phase) (f32.const 3.3)) (f32.const 7.7777))))
                      (f32.const 2.0))))
                (f32.store (i32.add (local.get $off) (i32.const 8))
                  (f32.add (local.get $cam_z) (f32.sub (f32.mul
                    (f32.sub (f32.mul (f32.add (local.get $phase) (f32.const 7.7)) (f32.const 5.5453))
                      (f32.trunc (f32.mul (f32.add (local.get $phase) (f32.const 7.7)) (f32.const 5.5453))))
                    (f32.const 10.0)) (f32.const 5.0))))
                (f32.store (i32.add (local.get $off) (i32.const 12)) (f32.const 0.15))
                (f32.store (i32.add (local.get $off) (i32.const 16)) (f32.const -0.4))
                (f32.store (i32.add (local.get $off) (i32.const 20)) (f32.const 0.05))
                (f32.store (i32.add (local.get $off) (i32.const 24))
                  (f32.add (f32.const 4.0)
                    (f32.mul
                      (f32.sub (f32.mul (f32.add (local.get $phase) (f32.const 1.1)) (f32.const 3.14))
                        (f32.trunc (f32.mul (f32.add (local.get $phase) (f32.const 1.1)) (f32.const 3.14))))
                      (f32.const 4.0))))
                (f32.store (i32.add (local.get $off) (i32.const 28))
                  (f32.load (i32.add (local.get $off) (i32.const 24))))
                (local.set $active (i32.add (local.get $active) (i32.const 1)))
              )
            )

            (local.set $off (i32.add (local.get $off) (i32.const 32)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)
          )
        )

        (local.set $phase (f32.add (global.get $time) (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 2.1))))

        (local.set $vx (f32.add (f32.const 0.15)
          (f32.mul (f32.sub
            (f32.mul (local.get $phase) (f32.const 1.3))
            (f32.trunc (f32.mul (local.get $phase) (f32.const 1.3)))
          ) (f32.const 0.0))))
        (local.set $vx (f32.add (local.get $vx)
          (f32.mul
            (f32.sub (f32.mul (local.get $phase) (f32.const 0.7))
              (f32.trunc (f32.mul (local.get $phase) (f32.const 0.7))))
            (f32.const 0.3))))

        (f32.store (local.get $off)
          (f32.add (local.get $x) (f32.mul (local.get $vx) (local.get $dt))))
        (f32.store (i32.add (local.get $off) (i32.const 4))
          (f32.add (local.get $y) (f32.mul (local.get $vy) (local.get $dt))))
        (f32.store (i32.add (local.get $off) (i32.const 8))
          (f32.add (local.get $z) (f32.mul (local.get $vz) (local.get $dt))))
        (f32.store (i32.add (local.get $off) (i32.const 24))
          (f32.sub (local.get $life) (local.get $dt)))

        (local.set $active (i32.add (local.get $active) (i32.const 1)))

        (local.set $off (i32.add (local.get $off) (i32.const 32)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (global.set $leaf_count (local.get $active))
    (i32.store (i32.add (global.get $OFF_METRICS) (i32.const 8)) (local.get $active))
  )

  (func (export "update_grass") (param $dt f32) (param $cam_x f32) (param $cam_z f32)
    (local $i i32)
    (local $off i32)
    (local $bx f32) (local $by f32) (local $bz f32)
    (local $sway f32) (local $height f32)
    (local $dx f32) (local $dz f32) (local $dist_sq f32)
    (local $active i32)
    (local $phase f32)
    (local $t f32)

    (local.set $i (i32.const 0))
    (local.set $off (global.get $OFF_GRASS))
    (local.set $active (i32.const 0))
    (local.set $t (global.get $time))

    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (global.get $grass_total)))

        (local.set $bx (f32.load (local.get $off)))
        (local.set $by (f32.load (i32.add (local.get $off) (i32.const 4))))
        (local.set $bz (f32.load (i32.add (local.get $off) (i32.const 8))))
        (local.set $height (f32.load (i32.add (local.get $off) (i32.const 12))))

        (local.set $dx (f32.sub (local.get $bx) (local.get $cam_x)))
        (local.set $dz (f32.sub (local.get $bz) (local.get $cam_z)))
        (local.set $dist_sq (f32.add (f32.mul (local.get $dx) (local.get $dx)) (f32.mul (local.get $dz) (local.get $dz))))

        (if (f32.le (local.get $dist_sq) (f32.const 225))
          (then
            (local.set $phase (f32.add
              (f32.mul (local.get $t) (f32.const 1.8))
              (f32.add (f32.mul (local.get $bx) (f32.const 1.3)) (f32.mul (local.get $bz) (f32.const 0.9)))))

            (local.set $sway (f32.mul
              (f32.sub (f32.mul (local.get $phase) (f32.const 0.15915))
                (f32.trunc (f32.mul (local.get $phase) (f32.const 0.15915))))
              (f32.const 6.2832)))
            (local.set $sway (f32.sub (local.get $sway) (f32.const 3.14159)))
            (local.set $sway (f32.sub
              (local.get $sway)
              (f32.div
                (f32.mul (f32.mul (local.get $sway) (local.get $sway)) (local.get $sway))
                (f32.const 6.0))))
            (local.set $sway (f32.mul (local.get $sway) (f32.const 0.04)))

            (f32.store (i32.add (local.get $off) (i32.const 16)) (local.get $sway))

            (f32.store (i32.add (local.get $off) (i32.const 20)) (f32.const 1.0))
            (local.set $active (i32.add (local.get $active) (i32.const 1)))
          )
          (else
            (f32.store (i32.add (local.get $off) (i32.const 20)) (f32.const 0.0))
          )
        )

        (local.set $off (i32.add (local.get $off) (i32.const 32)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (global.set $grass_count (local.get $active))
    (i32.store (i32.add (global.get $OFF_METRICS) (i32.const 12)) (local.get $active))
  )

  (func (export "set_grass_count") (param $n i32)
    (global.set $grass_count (local.get $n))
    (global.set $grass_total (local.get $n))
  )

  (func (export "update_creatures") (param $dt f32) (param $cam_x f32) (param $cam_z f32) (param $seed f32)
    (local $i i32)
    (local $off i32)
    (local $x f32) (local $y f32) (local $z f32)
    (local $vx f32) (local $vz f32)
    (local $life f32) (local $state f32)
    (local $active i32)
    (local $phase f32) (local $rnd f32)
    (local $target_x f32) (local $target_z f32)
    (local $dx f32) (local $dz f32)

    (local.set $i (i32.const 0))
    (local.set $off (global.get $OFF_CREATURES))
    (local.set $active (i32.const 0))

    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (global.get $MAX_CREATURES)))

        (local.set $x (f32.load (local.get $off)))
        (local.set $y (f32.load (i32.add (local.get $off) (i32.const 4))))
        (local.set $z (f32.load (i32.add (local.get $off) (i32.const 8))))
        (local.set $vx (f32.load (i32.add (local.get $off) (i32.const 12))))
        (local.set $vz (f32.load (i32.add (local.get $off) (i32.const 16))))
        (local.set $life (f32.load (i32.add (local.get $off) (i32.const 20))))
        (local.set $state (f32.load (i32.add (local.get $off) (i32.const 24))))

        (if (f32.le (local.get $life) (f32.const 0))
          (then
            (local.set $phase (f32.add (local.get $seed) (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 17.31))))
            (local.set $rnd (f32.sub
              (f32.mul (local.get $phase) (f32.const 43758.5453))
              (f32.trunc (f32.mul (local.get $phase) (f32.const 43758.5453)))))

            (if (f32.lt (local.get $rnd) (f32.mul (local.get $dt) (f32.const 0.08)))
              (then
                (local.set $phase (f32.add (local.get $seed) (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 31.7))))

                (local.set $rnd (f32.sub
                  (f32.mul (local.get $phase) (f32.const 12.9898))
                  (f32.trunc (f32.mul (local.get $phase) (f32.const 12.9898)))))
                (local.set $dx (f32.sub (f32.mul (local.get $rnd) (f32.const 8.0)) (f32.const 4.0)))

                (local.set $rnd (f32.sub
                  (f32.mul (f32.add (local.get $phase) (f32.const 5.5)) (f32.const 7.777))
                  (f32.trunc (f32.mul (f32.add (local.get $phase) (f32.const 5.5)) (f32.const 7.777)))))
                (local.set $dz (f32.sub (f32.mul (local.get $rnd) (f32.const 8.0)) (f32.const 4.0)))

                (f32.store (local.get $off) (f32.add (local.get $cam_x) (local.get $dx)))
                (f32.store (i32.add (local.get $off) (i32.const 4)) (f32.const 0.0))
                (f32.store (i32.add (local.get $off) (i32.const 8)) (f32.add (local.get $cam_z) (local.get $dz)))
                (f32.store (i32.add (local.get $off) (i32.const 12)) (f32.const 0.0))
                (f32.store (i32.add (local.get $off) (i32.const 16)) (f32.const 0.0))
                (f32.store (i32.add (local.get $off) (i32.const 20))
                  (f32.add (f32.const 6.0)
                    (f32.mul (f32.sub
                      (f32.mul (f32.add (local.get $phase) (f32.const 2.2)) (f32.const 3.14))
                      (f32.trunc (f32.mul (f32.add (local.get $phase) (f32.const 2.2)) (f32.const 3.14))))
                    (f32.const 6.0))))
                (f32.store (i32.add (local.get $off) (i32.const 24)) (f32.const 1.0))
                (f32.store (i32.add (local.get $off) (i32.const 28)) (f32.const 0.0))
                (local.set $active (i32.add (local.get $active) (i32.const 1)))
              )
            )

            (local.set $off (i32.add (local.get $off) (i32.const 32)))
            (local.set $i (i32.add (local.get $i) (i32.const 1)))
            (br $loop)
          )
        )

        (local.set $state (f32.load (i32.add (local.get $off) (i32.const 28))))
        (local.set $state (f32.sub (local.get $state) (local.get $dt)))

        (if (f32.le (local.get $state) (f32.const 0))
          (then
            (local.set $phase (f32.add (global.get $time) (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 5.5))))
            (local.set $rnd (f32.sub
              (f32.mul (local.get $phase) (f32.const 9.898))
              (f32.trunc (f32.mul (local.get $phase) (f32.const 9.898)))))
            (f32.store (i32.add (local.get $off) (i32.const 12))
              (f32.mul (f32.sub (f32.mul (local.get $rnd) (f32.const 2.0)) (f32.const 1.0)) (f32.const 0.3)))

            (local.set $rnd (f32.sub
              (f32.mul (f32.add (local.get $phase) (f32.const 3.3)) (f32.const 7.777))
              (f32.trunc (f32.mul (f32.add (local.get $phase) (f32.const 3.3)) (f32.const 7.777)))))
            (f32.store (i32.add (local.get $off) (i32.const 16))
              (f32.mul (f32.sub (f32.mul (local.get $rnd) (f32.const 2.0)) (f32.const 1.0)) (f32.const 0.3)))

            (f32.store (i32.add (local.get $off) (i32.const 28))
              (f32.add (f32.const 1.5) (f32.mul (local.get $rnd) (f32.const 3.0))))
          )
        )

        (f32.store (local.get $off)
          (f32.add (local.get $x) (f32.mul (f32.load (i32.add (local.get $off) (i32.const 12))) (local.get $dt))))
        (f32.store (i32.add (local.get $off) (i32.const 8))
          (f32.add (local.get $z) (f32.mul (f32.load (i32.add (local.get $off) (i32.const 16))) (local.get $dt))))

        (f32.store (i32.add (local.get $off) (i32.const 20))
          (f32.sub (local.get $life) (local.get $dt)))
        (f32.store (i32.add (local.get $off) (i32.const 28))
          (local.get $state))

        (local.set $active (i32.add (local.get $active) (i32.const 1)))

        (local.set $off (i32.add (local.get $off) (i32.const 32)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (global.set $creature_count (local.get $active))
    (i32.store (i32.add (global.get $OFF_METRICS) (i32.const 16)) (local.get $active))
  )

  (func (export "set_time") (param $t f32)
    (global.set $time (local.get $t))
  )

  (func (export "get_leaf_count") (result i32) (global.get $leaf_count))
  (func (export "get_creature_count") (result i32) (global.get $creature_count))

  ;; ── Horror entity system ──
  ;; Horror config buffer (OFF_HORROR_CFG, 32 bytes / 8 f32):
  ;;   [0] writhing_intensity  [1] agitation  [2] pulse_speed  [3] spring_k
  ;;   [4] damping             [5] twitch_chance  [6] _pad  [7] _pad

  (func $horror_cfg (param $idx i32) (result f32)
    (f32.load (i32.add (global.get $OFF_HORROR_CFG) (i32.mul (local.get $idx) (i32.const 4))))
  )

  ;; Pseudo-random hash for deterministic twitch/impulse
  (func $horror_hash (param $v f32) (result f32)
    (local $x f32)
    (local.set $x (f32.mul (local.get $v) (f32.const 43758.5453)))
    (f32.sub (local.get $x) (f32.trunc (local.get $x)))
  )

  ;; sin approximation (Bhaskara-style, good enough for animation)
  (func $fsin (param $x f32) (result f32)
    (local $xn f32)
    ;; normalize to [-pi, pi]
    (local.set $xn (f32.sub (local.get $x)
      (f32.mul (f32.trunc (f32.div (local.get $x) (f32.const 6.2831853)))
               (f32.const 6.2831853))))
    ;; if > pi, subtract 2pi
    (if (f32.gt (local.get $xn) (f32.const 3.1415927))
      (then (local.set $xn (f32.sub (local.get $xn) (f32.const 6.2831853)))))
    (if (f32.lt (local.get $xn) (f32.const -3.1415927))
      (then (local.set $xn (f32.add (local.get $xn) (f32.const 6.2831853)))))
    ;; parabolic approximation
    (f32.mul (f32.mul (f32.const 1.2732395) (local.get $xn))
      (f32.sub (f32.const 1.0)
        (f32.mul (f32.const 0.10132) (f32.mul (local.get $xn) (local.get $xn)))))
  )

  (func $fcos (param $x f32) (result f32)
    (call $fsin (f32.add (local.get $x) (f32.const 1.5707963)))
  )

  ;; Update all horror segments: undulation, spring, damping, twitch, pulsing
  ;; Called once per frame from JS after horror entities have been generated
  (func (export "update_horrors") (param $dt f32) (param $cam_x f32) (param $cam_z f32)
    (local $i i32)
    (local $off i32)
    (local $x f32) (local $y f32) (local $z f32)
    (local $rx f32) (local $ry f32) (local $rz f32)
    (local $vx f32) (local $vy f32) (local $vz f32)
    (local $phase f32) (local $size f32) (local $flags f32)
    (local $parent_off i32)
    (local $parent_idx i32)
    (local $seg_type i32)
    (local $entity_id i32)
    (local $active i32)
    (local $dx f32) (local $dy f32) (local $dz f32)
    (local $spring_k f32) (local $damping f32) (local $writhe f32)
    (local $pulse_speed f32) (local $agitation f32) (local $twitch f32)
    (local $undulate f32) (local $rnd f32)
    (local $ent_off i32) (local $ent_pulse f32) (local $ent_agit f32)
    (local $px f32) (local $py f32) (local $pz f32)
    (local $dist f32) (local $force f32)

    ;; Read config
    (local.set $writhe (call $horror_cfg (i32.const 0)))
    (local.set $agitation (call $horror_cfg (i32.const 1)))
    (local.set $pulse_speed (call $horror_cfg (i32.const 2)))
    (local.set $spring_k (call $horror_cfg (i32.const 3)))
    (local.set $damping (call $horror_cfg (i32.const 4)))
    (local.set $twitch (call $horror_cfg (i32.const 5)))

    ;; Update entity pulses first
    (local.set $i (i32.const 0))
    (block $ent_break
      (loop $ent_loop
        (br_if $ent_break (i32.ge_u (local.get $i) (global.get $MAX_HORROR_ENT)))
        (local.set $ent_off (i32.add (global.get $OFF_HORROR_ENT)
          (i32.mul (local.get $i) (global.get $HORROR_ENT_STRIDE))))

        ;; Check active (offset 36 in entity = f32 index 9)
        (if (f32.gt (f32.load (i32.add (local.get $ent_off) (i32.const 36))) (f32.const 0))
          (then
            ;; Advance pulse phase (offset 32 = f32 index 8)
            (f32.store (i32.add (local.get $ent_off) (i32.const 32))
              (f32.add
                (f32.load (i32.add (local.get $ent_off) (i32.const 32)))
                (f32.mul (local.get $dt) (local.get $pulse_speed))))

            ;; Update agitation: decay toward base with occasional spikes
            (local.set $ent_agit (f32.load (i32.add (local.get $ent_off) (i32.const 28))))
            ;; Decay toward base agitation
            (local.set $ent_agit (f32.add
              (f32.mul (local.get $ent_agit) (f32.sub (f32.const 1.0) (f32.mul (local.get $dt) (f32.const 0.5))))
              (f32.mul (local.get $agitation) (f32.mul (local.get $dt) (f32.const 0.5)))))
            ;; Random twitch spikes
            (local.set $rnd (call $horror_hash (f32.add (global.get $time)
              (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 7.77)))))
            (if (f32.lt (local.get $rnd) (f32.mul (local.get $twitch) (local.get $dt)))
              (then
                (local.set $ent_agit (f32.add (local.get $ent_agit)
                  (f32.mul (local.get $agitation) (f32.const 3.0))))))
            (f32.store (i32.add (local.get $ent_off) (i32.const 28)) (local.get $ent_agit))
          )
        )

        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $ent_loop)
      )
    )

    ;; Update segments
    (local.set $i (i32.const 0))
    (local.set $off (global.get $OFF_HORROR_SEG))
    (local.set $active (i32.const 0))

    (block $break
      (loop $loop
        (br_if $break (i32.ge_u (local.get $i) (global.get $MAX_HORROR_SEG)))

        ;; Read segment data
        (local.set $x (f32.load (local.get $off)))
        (local.set $y (f32.load (i32.add (local.get $off) (i32.const 4))))
        (local.set $z (f32.load (i32.add (local.get $off) (i32.const 8))))
        (local.set $rx (f32.load (i32.add (local.get $off) (i32.const 12))))
        (local.set $ry (f32.load (i32.add (local.get $off) (i32.const 16))))
        (local.set $rz (f32.load (i32.add (local.get $off) (i32.const 20))))
        (local.set $vx (f32.load (i32.add (local.get $off) (i32.const 24))))
        (local.set $vy (f32.load (i32.add (local.get $off) (i32.const 28))))
        (local.set $vz (f32.load (i32.add (local.get $off) (i32.const 32))))
        (local.set $phase (f32.load (i32.add (local.get $off) (i32.const 36))))
        (local.set $size (f32.load (i32.add (local.get $off) (i32.const 40))))
        (local.set $flags (f32.load (i32.add (local.get $off) (i32.const 44))))

        ;; Decode flags: active bit is lowest bit of the i32 reinterpretation
        ;; We use a simpler convention: flags > 0 means active
        (if (f32.gt (local.get $flags) (f32.const 0))
          (then
            (local.set $active (i32.add (local.get $active) (i32.const 1)))

            ;; Decode type and parent from flags
            ;; flags encoding: type * 100000 + parent_idx * 100 + entity_id + 1
            ;; (the +1 ensures flags > 0 for active segments)
            (local.set $seg_type (i32.trunc_f32_u
              (f32.trunc (f32.div (local.get $flags) (f32.const 100000)))))
            (local.set $parent_idx (i32.trunc_f32_u
              (f32.trunc (f32.div
                (f32.sub (local.get $flags) (f32.mul (f32.convert_i32_u (local.get $seg_type)) (f32.const 100000)))
                (f32.const 100)))))
            (local.set $entity_id (i32.trunc_f32_u
              (f32.sub
                (f32.sub (local.get $flags)
                  (f32.add
                    (f32.mul (f32.convert_i32_u (local.get $seg_type)) (f32.const 100000))
                    (f32.mul (f32.convert_i32_u (local.get $parent_idx)) (f32.const 100))))
                (f32.const 1))))

            ;; Get entity agitation and pulse
            (local.set $ent_off (i32.add (global.get $OFF_HORROR_ENT)
              (i32.mul (local.get $entity_id) (global.get $HORROR_ENT_STRIDE))))
            (local.set $ent_agit (f32.load (i32.add (local.get $ent_off) (i32.const 28))))
            (local.set $ent_pulse (f32.load (i32.add (local.get $ent_off) (i32.const 32))))

            ;; Advance phase
            (local.set $phase (f32.add (local.get $phase)
              (f32.mul (local.get $dt) (f32.add (f32.const 1.0)
                (f32.mul (local.get $ent_agit) (f32.const 0.5))))))
            (f32.store (i32.add (local.get $off) (i32.const 36)) (local.get $phase))

            ;; === Compute forces ===

            ;; 1. Spring toward rest position
            (local.set $dx (f32.sub (local.get $rx) (local.get $x)))
            (local.set $dy (f32.sub (local.get $ry) (local.get $y)))
            (local.set $dz (f32.sub (local.get $rz) (local.get $z)))

            (local.set $vx (f32.add (local.get $vx)
              (f32.mul (local.get $dx) (f32.mul (local.get $spring_k) (local.get $dt)))))
            (local.set $vy (f32.add (local.get $vy)
              (f32.mul (local.get $dy) (f32.mul (local.get $spring_k) (local.get $dt)))))
            (local.set $vz (f32.add (local.get $vz)
              (f32.mul (local.get $dz) (f32.mul (local.get $spring_k) (local.get $dt)))))

            ;; 2. Undulation force (type-dependent: tendrils get phase-shifted wave)
            ;; Types: 0=core, 1=tendril, 2=eye, 3=tooth, 4=sucker, 5=ring, 6=spine
            (if (i32.or (i32.eq (local.get $seg_type) (i32.const 1))
                        (i32.eq (local.get $seg_type) (i32.const 4)))
              (then
                ;; Tendril/sucker: lateral undulation
                (local.set $undulate (f32.mul (local.get $writhe)
                  (f32.mul
                    (call $fsin (f32.add (local.get $phase) (local.get $ent_pulse)))
                    (f32.mul (local.get $size) (f32.const 0.8)))))
                (local.set $vx (f32.add (local.get $vx)
                  (f32.mul (local.get $undulate) (local.get $dt))))
                (local.set $vy (f32.add (local.get $vy)
                  (f32.mul (f32.mul (local.get $undulate) (f32.const 0.3)) (local.get $dt))))
              )
            )
            (if (i32.eq (local.get $seg_type) (i32.const 5))
              (then
                ;; Ring/orbit: circular motion impulse
                (local.set $undulate (f32.mul (local.get $writhe)
                  (call $fsin (f32.add (f32.mul (local.get $phase) (f32.const 1.5)) (local.get $ent_pulse)))))
                (local.set $vx (f32.add (local.get $vx)
                  (f32.mul (local.get $undulate) (local.get $dt))))
                (local.set $vz (f32.add (local.get $vz)
                  (f32.mul
                    (f32.mul (local.get $writhe)
                      (call $fcos (f32.add (f32.mul (local.get $phase) (f32.const 1.5)) (local.get $ent_pulse))))
                    (local.get $dt))))
              )
            )

            ;; 3. Breathing/pulsing (all types get subtle vertical pulse)
            (local.set $vy (f32.add (local.get $vy)
              (f32.mul
                (f32.mul (call $fsin (f32.mul (local.get $ent_pulse) (f32.const 2.0)))
                         (f32.const 0.15))
                (local.get $dt))))

            ;; 4. Agitation twitch (random impulse bursts)
            (if (f32.gt (local.get $ent_agit) (f32.const 1.0))
              (then
                (local.set $rnd (call $horror_hash
                  (f32.add (local.get $phase) (f32.mul (f32.convert_i32_u (local.get $i)) (f32.const 3.14)))))
                (local.set $vx (f32.add (local.get $vx)
                  (f32.mul (f32.sub (local.get $rnd) (f32.const 0.5))
                    (f32.mul (local.get $ent_agit) (f32.mul (local.get $dt) (f32.const 2.0))))))
                (local.set $rnd (call $horror_hash (f32.add (local.get $rnd) (f32.const 0.333))))
                (local.set $vz (f32.add (local.get $vz)
                  (f32.mul (f32.sub (local.get $rnd) (f32.const 0.5))
                    (f32.mul (local.get $ent_agit) (f32.mul (local.get $dt) (f32.const 2.0))))))
              )
            )

            ;; 5. Parent constraint: if parent exists, apply cohesion toward parent pos
            (if (i32.gt_u (local.get $parent_idx) (i32.const 0))
              (then
                ;; parent_idx is 1-based (0 = no parent), so subtract 1
                (local.set $parent_off (i32.add (global.get $OFF_HORROR_SEG)
                  (i32.mul (i32.sub (local.get $parent_idx) (i32.const 1)) (global.get $HORROR_SEG_STRIDE))))
                (local.set $px (f32.load (local.get $parent_off)))
                (local.set $py (f32.load (i32.add (local.get $parent_off) (i32.const 4))))
                (local.set $pz (f32.load (i32.add (local.get $parent_off) (i32.const 8))))
                ;; Cohesion: gently pull toward parent (weaker than spring to rest)
                (local.set $dx (f32.sub (local.get $px) (local.get $x)))
                (local.set $dy (f32.sub (local.get $py) (local.get $y)))
                (local.set $dz (f32.sub (local.get $pz) (local.get $z)))
                (local.set $dist (f32.sqrt (f32.add
                  (f32.add (f32.mul (local.get $dx) (local.get $dx))
                           (f32.mul (local.get $dy) (local.get $dy)))
                  (f32.mul (local.get $dz) (local.get $dz)))))
                ;; Only apply if stretched too far (> size * 2)
                (if (f32.gt (local.get $dist) (f32.mul (local.get $size) (f32.const 2.0)))
                  (then
                    (local.set $force (f32.mul
                      (f32.sub (local.get $dist) (f32.mul (local.get $size) (f32.const 2.0)))
                      (f32.const 3.0)))
                    (if (f32.gt (local.get $dist) (f32.const 0.001))
                      (then
                        (local.set $vx (f32.add (local.get $vx)
                          (f32.mul (f32.div (local.get $dx) (local.get $dist))
                            (f32.mul (local.get $force) (local.get $dt)))))
                        (local.set $vy (f32.add (local.get $vy)
                          (f32.mul (f32.div (local.get $dy) (local.get $dist))
                            (f32.mul (local.get $force) (local.get $dt)))))
                        (local.set $vz (f32.add (local.get $vz)
                          (f32.mul (f32.div (local.get $dz) (local.get $dist))
                            (f32.mul (local.get $force) (local.get $dt)))))
                      )
                    )
                  )
                )
              )
            )

            ;; Apply damping
            (local.set $vx (f32.mul (local.get $vx) (f32.sub (f32.const 1.0)
              (f32.mul (local.get $damping) (local.get $dt)))))
            (local.set $vy (f32.mul (local.get $vy) (f32.sub (f32.const 1.0)
              (f32.mul (local.get $damping) (local.get $dt)))))
            (local.set $vz (f32.mul (local.get $vz) (f32.sub (f32.const 1.0)
              (f32.mul (local.get $damping) (local.get $dt)))))

            ;; Integrate position
            (local.set $x (f32.add (local.get $x) (f32.mul (local.get $vx) (local.get $dt))))
            (local.set $y (f32.add (local.get $y) (f32.mul (local.get $vy) (local.get $dt))))
            (local.set $z (f32.add (local.get $z) (f32.mul (local.get $vz) (local.get $dt))))

            ;; Write back
            (f32.store (local.get $off) (local.get $x))
            (f32.store (i32.add (local.get $off) (i32.const 4)) (local.get $y))
            (f32.store (i32.add (local.get $off) (i32.const 8)) (local.get $z))
            (f32.store (i32.add (local.get $off) (i32.const 24)) (local.get $vx))
            (f32.store (i32.add (local.get $off) (i32.const 28)) (local.get $vy))
            (f32.store (i32.add (local.get $off) (i32.const 32)) (local.get $vz))
          )
        )

        (local.set $off (i32.add (local.get $off) (global.get $HORROR_SEG_STRIDE)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $loop)
      )
    )

    (global.set $horror_active_seg (local.get $active))
  )

  (func (export "get_horror_seg_count") (result i32) (global.get $horror_active_seg))
  (func (export "get_horror_ent_count") (result i32) (global.get $horror_active_ent))
  (func (export "set_horror_ent_count") (param $n i32) (global.set $horror_active_ent (local.get $n)))
)
