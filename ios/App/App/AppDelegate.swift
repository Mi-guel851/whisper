import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Push notification deep links
    //
    // A tap on a Whisper push opens the app straight onto the surface the
    // payload describes. On iOS that tap is delivered by the Capacitor
    // PushNotifications plugin — it owns the UNUserNotificationCenterDelegate,
    // so this file deliberately implements NO delegate methods of its own:
    // adding them would intercept taps before the plugin and the web layer
    // would never hear about them. The tap arrives in JavaScript as
    // `pushNotificationActionPerformed`, and the router there
    // (lib/push/useRegisterPushNotifications.ts) navigates by the payload's
    // `route` field with these per-type fallbacks:
    //
    //   message        → /chat/{conversation_id}
    //   whisper        → /notifications
    //   feed           → /public-feed?post={postId}
    //   friend_request → /friends
    //   coins          → /premium
    //   call           → /chat/{conversation_id} + the ring overlay, triggered
    //                    immediately via the pending-call stash
    //
    // `WhisperPushRoutes` below mirrors that contract on the native side, so a
    // future native handler (CallKit, Notification Service Extension) starts
    // from the same destinations instead of inventing its own.

}

/// The push-tap destinations, mirrored from the web router (see above).
/// Pure mapping, no side effects — safe to call from any future native
/// notification handler.
enum WhisperPushRoutes {
    static func destination(
        type: String?,
        route: String?,
        conversationId: String?,
        postId: String?
    ) -> String? {
        if let route = route, isSafeRoute(route) {
            return route
        }
        switch type {
        case "message":
            return conversationId.map { "/chat/\($0)" } ?? "/inbox"
        case "whisper":
            return "/notifications"
        case "feed", "reply", "public_feed":
            return postId.map { "/public-feed?post=\($0)" } ?? "/public-feed"
        case "friend_request":
            return "/friends"
        case "coins", "coin_transfer":
            return "/premium"
        case "call":
            return conversationId.map { "/chat/\($0)" } ?? "/inbox"
        default:
            return conversationId.map { "/chat/\($0)" }
        }
    }

    /// The same allowlist the web router applies: own surfaces only, so a
    /// crafted payload can never turn a tap into an open redirect.
    static func isSafeRoute(_ route: String) -> Bool {
        let pattern = "^/(chat/[A-Za-z0-9-]+|inbox|friends|notifications|premium|public-feed|dashboard)(\\?[A-Za-z0-9_\\-=&%.]*)?$"
        return route.range(of: pattern, options: .regularExpression) != nil
    }
}
