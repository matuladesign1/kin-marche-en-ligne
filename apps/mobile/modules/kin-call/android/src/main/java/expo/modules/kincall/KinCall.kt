package expo.modules.kincall

import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import java.lang.ref.WeakReference

/**
 * Nouvelle course pour le livreur : notification « appel entrant » (catégorie appel, plein écran,
 * sonnerie répétée du canal « missions_appel ») qui allume l'écran et s'affiche par-dessus l'écran verrouillé.
 */
object KinCall {
  const val CHANNEL_ID = "missions_appel"
  const val NOTIFICATION_ID = 7310
  const val EXTRA_CALL = "kin_call"

  /** Activité principale (pour afficher l'appel par-dessus l'écran verrouillé). */
  var activity: WeakReference<Activity>? = null

  fun show(context: Context, title: String, body: String, timeoutMs: Long) {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    launch.putExtra(EXTRA_CALL, true)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
    val pending = PendingIntent.getActivity(context, NOTIFICATION_ID, launch, flags)

    var icon = context.resources.getIdentifier("notification_icon", "drawable", context.packageName)
    if (icon == 0) icon = context.applicationInfo.icon

    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(icon)
      .setColor(0xFF1CB7B8.toInt())
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(true)
      .setContentIntent(pending)
      .setFullScreenIntent(pending, true)
      .setTimeoutAfter(timeoutMs)
      .build()
    // La sonnerie se répète jusqu'à la réponse (ou la fin de l'offre), comme un vrai appel.
    notification.flags = notification.flags or Notification.FLAG_INSISTENT
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, notification)
  }

  fun cancel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(NOTIFICATION_ID)
    activity?.get()?.let { releaseLockScreen(it) }
  }

  /** Allume l'écran et affiche l'application par-dessus l'écran verrouillé (le temps de l'appel). */
  fun showOverLockScreen(a: Activity) {
    a.runOnUiThread {
      if (Build.VERSION.SDK_INT >= 27) {
        a.setShowWhenLocked(true)
        a.setTurnScreenOn(true)
      } else {
        @Suppress("DEPRECATION")
        a.window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
      }
      a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  fun releaseLockScreen(a: Activity) {
    a.runOnUiThread {
      if (Build.VERSION.SDK_INT >= 27) {
        a.setShowWhenLocked(false)
        a.setTurnScreenOn(false)
      } else {
        @Suppress("DEPRECATION")
        a.window.clearFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
      }
      a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  /** Android 14+ : l'utilisateur peut retirer l'autorisation « notifications plein écran ». */
  fun canUseFullScreenIntent(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 34) return true
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return manager.canUseFullScreenIntent()
  }

  fun openFullScreenSettings(context: Context) {
    val intent = if (Build.VERSION.SDK_INT >= 34) {
      Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + context.packageName))
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + context.packageName))
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }
}
